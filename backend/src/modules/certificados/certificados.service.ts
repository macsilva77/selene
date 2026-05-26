import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfigService } from '../../config/app-config.service';
import { AuditAcao, CertificadoAcao, CertificadoStatus, Prisma } from '@prisma/client';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import * as forge from 'node-forge';
import { PrismaService } from '../../database/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ArmazenarCertificadoDto } from './dto/armazenar-certificado.dto';
import { buildMeta, calcSkip } from '../../common/utils/pagination.helper';
import { AuditableService } from '../../common/services/auditable.service';
import { requireTenantId } from '../../common/context/tenant-context';
import { PubSubService } from '../../common/services/pubsub.service';

// ─── Internal types ──────────────────────────────────────────────────────────

interface ParsedCert {
  razaoSocial: string;
  cnpjCert: string;
  raizCnpj: string;
  numeroSerie: string;
  autoridadeCert: string;
  dataEmissao: Date;
  dataValidade: Date;
  thumbprint: string;
  status: CertificadoStatus;
  diasParaVencer: number;
  /** Certificado público PEM (para conexões mTLS sem precisar da senha) */
  pemCert: string;
  /** Chave privada PEM (para conexões mTLS sem precisar da senha) */
  pemKey: string;
}

type ParseResult =
  | { ok: true; data: ParsedCert }
  | { ok: false; errorCode: string; errorMessage: string };

interface EmpresaRow {
  id: string;
  nome: string;
  nome_fantasia: string | null;
  cnpj: string;
  tipo_estabelecimento: string | null;
  ativo: boolean;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class CertificadosService extends AuditableService {
  private readonly logger = new Logger(CertificadosService.name);
  private readonly encKey: Buffer;

  private readonly topicNovoCertificado: string;

  constructor(
    private readonly prisma: PrismaService,
    auditoria: AuditoriaService,
    private readonly appConfig: AppConfigService,
    private readonly configService: ConfigService,
    private readonly pubSub: PubSubService,
  ) {
    super(auditoria);
    const hexKey = this.appConfig.certEncryptionKey;
    if (hexKey.length < 64) {
      this.logger.warn('CERT_ENCRYPTION_KEY ausente/inválida — usando chave padrão (DEV ONLY)');
      this.encKey = Buffer.alloc(32, 0);
    } else {
      this.encKey = Buffer.from(hexKey.slice(0, 64), 'hex');
    }
    this.topicNovoCertificado = this.configService.get<string>('pubsub.topicNovoCertificado') ?? '';
  }

  // ── PFX Parsing ─────────────────────────────────────────────────────────────

  private parsePfx(buffer: Buffer, password: string): ParseResult {
    let p12: forge.pkcs12.Pkcs12Pfx;
    try {
      const p12Asn1 = forge.asn1.fromDer(buffer.toString('binary'));
      p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);
    } catch {
      return {
        ok: false,
        errorCode: 'SENHA_INVALIDA',
        errorMessage: 'Senha do certificado inválida. Verifique a senha e tente novamente.',
      };
    }

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBagList = certBags[forge.pki.oids.certBag];
    if (!certBagList?.length) {
      return {
        ok: false,
        errorCode: 'CERT_INVALIDO',
        errorMessage: 'Nenhum certificado encontrado no arquivo PFX.',
      };
    }

    const bagEntry = certBagList[0];
    if (!bagEntry.cert) {
      return { ok: false, errorCode: 'CERT_INVALIDO', errorMessage: 'Nenhum certificado encontrado no arquivo PFX.' };
    }
    const cert = bagEntry.cert;

    // Extrai chave privada dos keyBags
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const keyBagList = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
    const keyBagEntry = keyBagList[0];
    const pemKey = keyBagEntry?.key ? forge.pki.privateKeyToPem(keyBagEntry.key) : '';
    const pemCert = forge.pki.certificateToPem(cert);

    // Thumbprint SHA-1 (padrão ICP-Brasil)
    const md = forge.md.sha1.create();
    md.update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
    const thumbprint = `SHA1: ${md.digest().toHex().toUpperCase()}`;

    // Extrai CN (Razão Social)
    const cn = cert.subject.getField('CN')?.value ?? '';

    // Extrai CNPJ do serialNumber (padrão ICP-Brasil e-CNPJ A1)
    const serialAttr = cert.subject.getField('serialNumber')?.value ?? '';
    let cnpjRaw = serialAttr.replaceAll(/\D/g, '');
    if (cnpjRaw.length !== 14) {
      // Tenta extrair do CN no formato "NOME LTDA:12345678000195"
      const cnMatch = cn.match(/:(\d{14})$/) ?? cn.match(/(\d{14})/);
      cnpjRaw = cnMatch?.[1] ?? '00000000000000';
    }
    if (cnpjRaw.length !== 14) cnpjRaw = '00000000000000';

    const issuerCn = cert.issuer.getField('CN')?.value ?? 'AC Desconhecida';
    const dataEmissao = cert.validity.notBefore;
    const dataValidade = cert.validity.notAfter;

    const diasParaVencer = Math.ceil((dataValidade.getTime() - Date.now()) / 86_400_000);

    let status: CertificadoStatus;
    if (diasParaVencer < 0) status = CertificadoStatus.VENCIDO;
    else if (diasParaVencer <= 30) status = CertificadoStatus.EXPIRACAO_PROXIMA;
    else status = CertificadoStatus.ATIVO;

    return {
      ok: true,
      data: {
        razaoSocial: cn,
        cnpjCert: cnpjRaw,
        raizCnpj: cnpjRaw.slice(0, 8),
        numeroSerie: cert.serialNumber,
        autoridadeCert: issuerCn,
        dataEmissao,
        dataValidade,
        thumbprint,
        status,
        diasParaVencer,
        pemCert,
        pemKey,
      },
    };
  }

  // ── Encryption / Decryption (AES-256-GCM) ────────────────────────────────────

  private decryptFile(encrypted: Buffer, storageIv: string): Buffer {
    const [ivHex, authTagHex] = storageIv.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', this.encKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  private encryptFile(data: Buffer): { encrypted: Buffer; storageIv: string } {
    const iv = randomBytes(12); // GCM usa IV de 12 bytes
    const cipher = createCipheriv('aes-256-gcm', this.encKey, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Armazena iv:authTag juntos para decriptação posterior
    const storageIv = `${iv.toString('hex')}:${authTag.toString('hex')}`;
    return { encrypted, storageIv };
  }

  // ── PFX interno (para serviços internos) ─────────────────────────────────────

  private buildPfxFromPem(pemCert: string, pemKey: string): Buffer {
    const cert = forge.pki.certificateFromPem(pemCert);
    const key  = forge.pki.privateKeyFromPem(pemKey);
    const p12Asn1 = forge.pkcs12.toPkcs12Asn1(key, [cert], null, { algorithm: '3des' });
    return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
  }

  async exportarPfxInterno(cnpj: string): Promise<{ cnpj: string; pfx_base64: string }> {
    const cert = await this.prisma.certificadoDigital.findFirst({
      where: { cnpjCert: cnpj, ativo: true, status: { not: CertificadoStatus.REVOGADO } },
      orderBy: { criadoEm: 'desc' },
    });
    if (!cert) throw new NotFoundException(`Certificado ativo não encontrado para CNPJ ${cnpj}`);
    if (!cert.certPemEnc || !cert.certPemIv || !cert.keyPemEnc || !cert.keyPemIv) {
      throw new NotFoundException('Certificado não possui dados PEM armazenados');
    }

    const pemCert = this.decryptFile(cert.certPemEnc, cert.certPemIv).toString('utf8');
    const pemKey  = this.decryptFile(cert.keyPemEnc,  cert.keyPemIv).toString('utf8');
    const pfxBuf  = this.buildPfxFromPem(pemCert, pemKey);

    return { cnpj, pfx_base64: pfxBuf.toString('base64') };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private formatCnpj(raw: string): string {
    const d = raw.replaceAll(/\D/g, '').padStart(14, '0');
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }

  // ── Validar ─────────────────────────────────────────────────────────────────

  async validar(
    file: Express.Multer.File | undefined,
    password: string,
    tenantId: string,
    usuarioId: string,
    ip: string,
  ) {
    if (!file) {
      return { success: false, errorCode: 'FORMATO_INVALIDO', errorMessage: 'Arquivo não enviado ou formato inválido (.pfx/.p12).' };
    }

    const parseResult = this.parsePfx(file.buffer, password);
    if (!parseResult.ok) {
      return { success: false, errorCode: parseResult.errorCode, errorMessage: parseResult.errorMessage };
    }

    const parsed = parseResult.data;

    if (parsed.status === CertificadoStatus.VENCIDO) {
      return {
        success: false,
        errorCode: 'CERT_VENCIDO',
        errorMessage: `O certificado está vencido (validade: ${parsed.dataValidade.toLocaleDateString('pt-BR')}). Não é possível armazenar certificados vencidos.`,
      };
    }

    // Impede thumbprint duplicado dentro do mesmo tenant
    const existing = await this.prisma.certificadoDigital.findFirst({
      where: { tenantId, thumbprint: parsed.thumbprint, ativo: true },
    });
    if (existing) {
      throw new ConflictException('Este certificado já está cadastrado nesta conta.');
    }

    // Criptografa e persiste o arquivo PFX no banco (AES-256-GCM)
    const { encrypted, storageIv } = this.encryptFile(file.buffer);

    // Criptografa PEM cert e key separadamente (permite mTLS sem reter a senha)
    const { encrypted: certPemEnc, storageIv: certPemIv } = this.encryptFile(Buffer.from(parsed.pemCert, 'utf8'));
    const pemKeyEncResult = parsed.pemKey
      ? this.encryptFile(Buffer.from(parsed.pemKey, 'utf8'))
      : null;

    // Cria o registro (draft que será finalizado em /certificados)
    const cert = await this.prisma.certificadoDigital.create({
      data: {
        tenantId,
        criadoPorId: usuarioId,
        razaoSocial: parsed.razaoSocial,
        cnpjCert: parsed.cnpjCert,
        raizCnpj: parsed.raizCnpj,
        numeroSerie: parsed.numeroSerie,
        autoridadeCert: parsed.autoridadeCert,
        dataEmissao: parsed.dataEmissao,
        dataValidade: parsed.dataValidade,
        thumbprint: parsed.thumbprint,
        status: parsed.status,
        arquivoEnc: encrypted,
        storageIv,
        certPemEnc,
        certPemIv,
        keyPemEnc: pemKeyEncResult?.encrypted ?? null,
        keyPemIv: pemKeyEncResult?.storageIv ?? null,
        nomeArquivo: file.originalname,
      },
    });

    await this.audit('CertificadoDigital', cert.id, AuditAcao.UPLOAD, { usuarioId, depois: { thumbprint: parsed.thumbprint, status: parsed.status }, ipOrigem: ip });

    await this.prisma.certificadoLog.create({
      data: {
        certificadoId: cert.id,
        tenantId,
        usuarioId,
        acao: CertificadoAcao.UPLOAD,
        descricao: `Certificado "${file.originalname}" validado e criptografado (AES-256) com sucesso.`,
        ipOrigem: ip,
      },
    });

    return {
      success: true,
      certificado: {
        id: cert.id,
        razaoSocial: cert.razaoSocial,
        cnpjCert: cert.cnpjCert,
        cnpjCertFormatado: this.formatCnpj(cert.cnpjCert),
        raizCnpj: cert.raizCnpj,
        numeroSerie: cert.numeroSerie,
        autoridadeCert: cert.autoridadeCert,
        dataEmissao: cert.dataEmissao.toISOString(),
        dataValidade: cert.dataValidade.toISOString(),
        thumbprint: cert.thumbprint,
        status: cert.status,
        diasParaVencer: parsed.diasParaVencer,
      },
    };
  }

  // ── Empresas por raiz CNPJ ───────────────────────────────────────────────────

  async buscarEmpresasPorRaiz(raizCnpj: string) {
    const tenantId = requireTenantId();
    const raizDigits = raizCnpj.replaceAll(/\D/g, '').slice(0, 8);
    if (raizDigits.length !== 8) throw new BadRequestException('Raiz CNPJ deve ter 8 dígitos.');

    const rows = await this.prisma.$queryRaw<EmpresaRow[]>`
      SELECT id, nome, nome_fantasia, cnpj, tipo_estabelecimento, ativo
      FROM empresas
      WHERE tenant_id = ${tenantId}
        AND ativo = true
        AND REGEXP_REPLACE(cnpj, '[^0-9]', '', 'g') LIKE ${raizDigits + '%'}
      ORDER BY nome ASC
    `;

    if (!rows.length) return [];

    const empresaIds = rows.map((r) => r.id);

    // Uma única query para verificar certificados ativos por empresa
    const certAssocs = await this.prisma.certificadoEmpresa.findMany({
      where: {
        empresaId: { in: empresaIds },
        certificado: {
          ativo: true,
          status: { not: CertificadoStatus.REVOGADO },
        },
      },
      include: {
        certificado: {
          select: { id: true, numeroSerie: true, dataValidade: true, autoridadeCert: true },
        },
      },
    });

    const certMap = new Map(certAssocs.map((ca) => [ca.empresaId, ca.certificado]));

    return rows.map((e) => {
      const digits = e.cnpj.replaceAll(/\D/g, '');
      const certAtivo = certMap.get(e.id) ?? null;

      return {
        id: e.id,
        razaoSocial: e.nome,
        cnpj: digits,
        cnpjFormatado: this.formatCnpj(digits),
        raizCnpj: raizDigits,
        tipo: e.tipo_estabelecimento?.toUpperCase() === 'MATRIZ' ? 'MATRIZ' : 'FILIAL',
        statusEmpresa: e.ativo ? 'ATIVO' : 'INATIVO',
        certificadoAtivo: certAtivo
          ? {
              id: certAtivo.id,
              numeroSerie: certAtivo.numeroSerie,
              dataValidade: certAtivo.dataValidade.toISOString(),
              autoridadeCert: certAtivo.autoridadeCert,
            }
          : null,
      };
    });
  }

  // ── Armazenar (finaliza o wizard) ────────────────────────────────────────────

  async armazenar(
    dto: ArmazenarCertificadoDto,
    tenantId: string,
    usuarioId: string,
    ip: string,
  ) {
    const cert = await this.prisma.certificadoDigital.findFirst({
      where: { id: dto.certificadoId, tenantId, ativo: true },
    });
    if (!cert) throw new NotFoundException('Certificado não encontrado ou já processado.');

    // Busca nome do usuário para o log
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { nome: true },
    });
    const usuarioNome = usuario?.nome ?? 'Sistema';

    const logs: Array<{
      id: string;
      acao: string;
      descricao: string;
      usuarioNome: string;
      ipOrigem: string;
      createdAt: string;
      operacaoStatus: string;
    }> = [];

    const buildLogEntry = (acao: CertificadoAcao, descricao: string) => ({
      id: randomUUID(),
      acao: acao as string,
      descricao,
      usuarioNome,
      ipOrigem: ip,
      createdAt: new Date().toISOString(),
      operacaoStatus: 'SUCESSO',
    });

    await this.prisma.$transaction(async (tx) => {
      // Valida e associa empresas
      if (dto.empresaIds.length > 0) {
        const empresas = await tx.empresa.findMany({
          where: { id: { in: dto.empresaIds }, tenantId },
        });
        if (empresas.length !== dto.empresaIds.length) {
          throw new BadRequestException('Uma ou mais empresas selecionadas não pertencem a esta conta.');
        }

        await tx.certificadoEmpresa.createMany({
          data: dto.empresaIds.map((empresaId) => ({ certificadoId: cert.id, empresaId })),
          skipDuplicates: true,
        });

        for (const emp of empresas) {
          const descricao = `Certificado associado à empresa ${emp.nome} (${this.formatCnpj(emp.cnpj.replaceAll(/\D/g, ''))}).`;
          logs.push(buildLogEntry(CertificadoAcao.ASSOCIACAO, descricao));
          await tx.certificadoLog.create({
            data: {
              certificadoId: cert.id,
              tenantId,
              usuarioId,
              usuarioNome,
              acao: CertificadoAcao.ASSOCIACAO,
              descricao,
              ipOrigem: ip,
            },
          });
        }
      }

      // Salva procuração eletrônica
      if (dto.procuracao) {
        await tx.procuracaoEletronica.create({
          data: {
            certificadoId: cert.id,
            cnpjOutorgante: dto.procuracao.cnpjOutorgante,
            cpfCnpjOutorgado: dto.procuracao.cpfCnpjOutorgado,
            nomeOutorgado: dto.procuracao.nomeOutorgado,
            poderesDelegados: dto.procuracao.poderesDelegados,
            dataInicio: new Date(dto.procuracao.dataInicio),
            dataValidade: new Date(dto.procuracao.dataValidade),
          },
        });

        const validadeFormatada = new Date(dto.procuracao.dataValidade).toLocaleDateString('pt-BR');
        const descricao = `Procuração eletrônica associada ao outorgado "${dto.procuracao.nomeOutorgado}" (${dto.procuracao.cpfCnpjOutorgado}), válida até ${validadeFormatada}.`;
        logs.push(buildLogEntry(CertificadoAcao.ASSOCIACAO, descricao));
        await tx.certificadoLog.create({
          data: {
            certificadoId: cert.id,
            tenantId,
            usuarioId,
            usuarioNome,
            acao: CertificadoAcao.ASSOCIACAO,
            descricao,
            ipOrigem: ip,
          },
        });
      }
    });

    // Log principal de armazenamento
    const uploadLog = buildLogEntry(
      CertificadoAcao.UPLOAD,
      `Certificado "${cert.nomeArquivo}" armazenado com segurança (AES-256). ${dto.empresaIds.length} empresa(s) associada(s).`,
    );
    logs.unshift(uploadLog);
    await this.prisma.certificadoLog.create({
      data: {
        certificadoId: cert.id,
        tenantId,
        usuarioId,
        usuarioNome,
        acao: CertificadoAcao.UPLOAD,
        descricao: uploadLog.descricao,
        ipOrigem: ip,
        criadoEm: new Date(uploadLog.createdAt),
      },
    });

    await this.audit('CertificadoDigital', cert.id, AuditAcao.CREATE, { usuarioId, depois: { certificadoId: cert.id, empresaIds: dto.empresaIds, comProcuracao: !!dto.procuracao }, ipOrigem: ip });

    // Dispara pipeline de coleta de SPEDs para o CNPJ
    await this.pubSub.publish(this.topicNovoCertificado, {
      evento:    'novo_certificado',
      cnpj:      cert.cnpjCert,
      tenantId,
      timestamp: new Date().toISOString(),
    }).catch((err) => this.logger.error(`Falha ao publicar novo_certificado: ${err}`));

    return { success: true, message: 'Certificado armazenado e associado com sucesso.', logs };
  }

  // ── Listar ───────────────────────────────────────────────────────────────────

  async listar(
    params: { status?: CertificadoStatus; search?: string; page?: number; limit?: number },
  ) {
    const tenantId = requireTenantId();
    const { page = 1, limit = 20, status, search } = params;
    const skip = calcSkip(page, limit);

    const where: Prisma.CertificadoDigitalWhereInput = { tenantId, ativo: true };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { razaoSocial: { contains: search, mode: 'insensitive' } },
        { cnpjCert: { contains: search } },
        { thumbprint: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.certificadoDigital.findMany({
        where,
        orderBy: { dataValidade: 'asc' },
        skip,
        take: limit,
        include: { empresas: { include: { empresa: { select: { id: true, nome: true, cnpj: true } } } } },
      }),
      this.prisma.certificadoDigital.count({ where }),
    ]);

    return { data, meta: buildMeta(total, page, limit) };
  }

  // ── Buscar por ID ─────────────────────────────────────────────────────────────

  async buscarPorId(id: string) {
    const tenantId = requireTenantId();
    const cert = await this.prisma.certificadoDigital.findFirst({
      where: { id, tenantId, ativo: true },
      include: {
        empresas: { include: { empresa: true } },
        procuracao: true,
        logs: { orderBy: { criadoEm: 'desc' }, take: 50 },
      },
    });
    if (!cert) throw new NotFoundException('Certificado não encontrado.');
    return cert;
  }

  // ── Revogar ──────────────────────────────────────────────────────────────────

  async revogar(id: string, usuarioId: string, ip: string) {
    const tenantId = requireTenantId();
    const cert = await this.prisma.certificadoDigital.findFirst({
      where: { id, tenantId, ativo: true },
    });
    if (!cert) throw new NotFoundException('Certificado não encontrado.');
    if (cert.status === CertificadoStatus.REVOGADO) {
      throw new ConflictException('Certificado já está revogado.');
    }

    await this.prisma.$transaction([
      this.prisma.certificadoDigital.update({
        where: { id },
        data: { status: CertificadoStatus.REVOGADO, ativo: false },
      }),
      this.prisma.certificadoLog.create({
        data: {
          certificadoId: id,
          tenantId,
          usuarioId,
          acao: CertificadoAcao.REMOCAO,
          descricao: 'Certificado revogado pelo administrador.',
          ipOrigem: ip,
        },
      }),
    ]);

    await this.audit('CertificadoDigital', id, AuditAcao.INATIVAR, { usuarioId, antes: { status: cert.status }, depois: { status: CertificadoStatus.REVOGADO, ativo: false }, ipOrigem: ip });

    return { message: 'Certificado revogado com sucesso.' };
  }

  // ── Excluir (hard delete) ────────────────────────────────────────────────────

  async excluir(id: string, usuarioId: string, ip: string) {
    const tenantId = requireTenantId();
    const cert = await this.prisma.certificadoDigital.findFirst({ where: { id, tenantId } });
    if (!cert) throw new NotFoundException('Certificado não encontrado.');

    const dfeUsando = await this.prisma.dfeConfig.count({ where: { certificadoId: id } });
    if (dfeUsando > 0) {
      throw new ConflictException(
        'Certificado está vinculado a uma configuração DFe ativa. Remova o vínculo antes de excluir.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.certificadoLog.deleteMany({ where: { certificadoId: id } }),
      this.prisma.certificadoEmpresa.deleteMany({ where: { certificadoId: id } }),
      this.prisma.procuracaoEletronica.deleteMany({ where: { certificadoId: id } }),
      this.prisma.certificadoDigital.delete({ where: { id } }),
    ]);

    await this.audit('CertificadoDigital', id, AuditAcao.INATIVAR, {
      usuarioId,
      antes: { razaoSocial: cert.razaoSocial, cnpjCert: cert.cnpjCert, thumbprint: cert.thumbprint },
      depois: undefined,
      ipOrigem: ip,
    });

    return { message: 'Certificado excluído com sucesso.' };
  }

  // ── Logs ─────────────────────────────────────────────────────────────────────

  async buscarLogs(id: string) {
    const tenantId = requireTenantId();
    const cert = await this.prisma.certificadoDigital.findFirst({ where: { id, tenantId } });
    if (!cert) throw new NotFoundException('Certificado não encontrado.');

    const logs = await this.prisma.certificadoLog.findMany({
      where: { certificadoId: id },
      orderBy: { criadoEm: 'desc' },
    });

    return logs.map((l) => ({ ...l, id: l.id.toString() }));
  }
}
