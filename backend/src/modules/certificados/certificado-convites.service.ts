import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConviteCertificadoStatus, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { MailService } from '../../common/mail/mail.service';
import { CertificadosService } from './certificados.service';
import { CriarConviteDto } from './dto/criar-convite.dto';

const VALIDADE_PADRAO_HORAS = 72;

@Injectable()
export class CertificadoConvitesService {
  private readonly logger = new Logger(CertificadoConvitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appConfig: AppConfigService,
    private readonly mail: MailService,
    private readonly certificados: CertificadosService,
  ) {}

  private hash(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private linkDe(rawToken: string): string {
    return `${this.appConfig.frontendUrl}/onboarding/certificado/${rawToken}`;
  }

  // ── Criar convite (autenticado) ──────────────────────────────────────────────

  async criar(dto: CriarConviteDto, tenantId: string, usuarioId: string) {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hash(rawToken);
    const horas = dto.validadeHoras ?? VALIDADE_PADRAO_HORAS;
    const expiraEm = new Date(Date.now() + horas * 60 * 60 * 1000);

    const convite = await this.prisma.certificadoConvite.create({
      data: {
        tenantId,
        tokenHash,
        email: dto.email,
        apelido: dto.apelido?.trim() || null,
        expiraEm,
        criadoPorId: usuarioId,
      },
    });

    const link = this.linkDe(rawToken);

    try {
      await this.mail.enviarConviteCertificado(dto.email, link, dto.apelido?.trim() || null, horas);
    } catch {
      this.logger.warn(`Falha ao enviar e-mail de convite de certificado para ${dto.email}`);
    }

    // Retorna o link cru também (admin pode copiar e enviar por outro canal).
    return {
      id: convite.id,
      email: convite.email,
      apelido: convite.apelido,
      status: convite.status,
      expiraEm: convite.expiraEm.toISOString(),
      criadoEm: convite.criadoEm.toISOString(),
      link,
    };
  }

  // ── Listar convites (autenticado) ────────────────────────────────────────────

  async listar(tenantId: string) {
    // Marca como expirados os convites pendentes já vencidos (lazy).
    await this.prisma.certificadoConvite.updateMany({
      where: { tenantId, status: ConviteCertificadoStatus.PENDENTE, expiraEm: { lt: new Date() } },
      data: { status: ConviteCertificadoStatus.EXPIRADO },
    });

    const convites = await this.prisma.certificadoConvite.findMany({
      where: { tenantId },
      orderBy: { criadoEm: 'desc' },
      include: { criadoPor: { select: { nome: true } } },
    });

    return convites.map((c) => ({
      id: c.id,
      email: c.email,
      apelido: c.apelido,
      status: c.status,
      expiraEm: c.expiraEm.toISOString(),
      usadoEm: c.usadoEm?.toISOString() ?? null,
      razaoSocial: c.razaoSocial,
      cnpj: c.cnpj,
      criadoPor: c.criadoPor?.nome ?? null,
      criadoEm: c.criadoEm.toISOString(),
    }));
  }

  // ── Revogar convite (autenticado) ────────────────────────────────────────────

  async revogar(id: string, tenantId: string) {
    const convite = await this.prisma.certificadoConvite.findFirst({ where: { id, tenantId } });
    if (!convite) throw new NotFoundException('Convite não encontrado.');
    if (convite.status === ConviteCertificadoStatus.USADO) {
      throw new BadRequestException('Este convite já foi utilizado e não pode ser revogado.');
    }
    await this.prisma.certificadoConvite.update({
      where: { id },
      data: { status: ConviteCertificadoStatus.REVOGADO },
    });
    return { message: 'Convite revogado com sucesso.' };
  }

  // ── Validar token (público) ──────────────────────────────────────────────────

  /** Busca o convite válido pelo token cru. Lança se inválido/expirado/usado. */
  private async resolverConviteValido(rawToken: string) {
    const tokenHash = this.hash(rawToken);
    const convite = await this.prisma.certificadoConvite.findUnique({ where: { tokenHash } });

    if (!convite || convite.status === ConviteCertificadoStatus.REVOGADO) {
      throw new NotFoundException('Link inválido ou não encontrado.');
    }
    if (convite.status === ConviteCertificadoStatus.USADO) {
      throw new BadRequestException('Este link já foi utilizado.');
    }
    if (convite.expiraEm < new Date()) {
      if (convite.status === ConviteCertificadoStatus.PENDENTE) {
        await this.prisma.certificadoConvite.update({
          where: { id: convite.id },
          data: { status: ConviteCertificadoStatus.EXPIRADO },
        });
      }
      throw new BadRequestException('Este link expirou. Solicite um novo à equipe responsável.');
    }
    return convite;
  }

  async validarTokenPublico(rawToken: string) {
    const convite = await this.resolverConviteValido(rawToken);
    return {
      valido: true,
      apelido: convite.apelido,
      expiraEm: convite.expiraEm.toISOString(),
    };
  }

  // ── Consumir convite (público) ───────────────────────────────────────────────

  async consumirPublico(rawToken: string, buffer: Buffer, password: string, ip: string) {
    const convite = await this.resolverConviteValido(rawToken);

    const resultado = await this.certificados.armazenarDeOnboarding({
      buffer,
      password,
      tenantId: convite.tenantId,
      criadoPorId: convite.criadoPorId,
      ip,
    });

    await this.prisma.certificadoConvite.update({
      where: { id: convite.id },
      data: {
        status: ConviteCertificadoStatus.USADO,
        usadoEm: new Date(),
        ipUso: ip,
        certificadoId: resultado.certificadoId,
        empresaId: resultado.empresaId,
        razaoSocial: resultado.razaoSocial,
        cnpj: resultado.cnpj,
      } satisfies Prisma.CertificadoConviteUpdateInput,
    });

    return {
      success: true,
      razaoSocial: resultado.razaoSocial,
      cnpj: resultado.cnpj,
    };
  }
}
