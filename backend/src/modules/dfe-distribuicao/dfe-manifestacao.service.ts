import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditAcao, DfeManifestacaoStatus, DfeTipoDocumento, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { DfeCertLoaderService } from './dfe-cert-loader.service';
import { DfeSoapClientService } from './dfe-soap-client.service';
import { DfeNsuRedisRepository } from './dfe-nsu-redis.repository';
import { CSTAT, TIPO_EVENTO_MANIFESTACAO } from './dfe.types';
import { ManifestarDfeDto } from './dto/manifestar-dfe.dto';
import { buildMeta, parsePagination } from '../../common/utils/pagination.helper';

@Injectable()
export class DfeManifestacaoService {
  private readonly logger = new Logger(DfeManifestacaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly certLoader: DfeCertLoaderService,
    private readonly soapClient: DfeSoapClientService,
    private readonly nsuRepo: DfeNsuRedisRepository,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────────
  // Ciência automática (processamento em lote)
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Envia a Ciência da Operação (210210) automaticamente para todos os
   * documentos RES_NFE do tenant que ainda não possuem essa manifestação
   * com status ENVIADO.
   *
   * Escopo: documentos onde o CNPJ figura como terceiro (autXML) —
   * conjunto tipicamente pequeno. Ciência é pré-requisito para o
   * download do XML completo (procNFe).
   */
  async processarPendentes(filtro?: { tenantId?: string; cnpj?: string }): Promise<void> {
    this.logger.log('Processando pendentes de Ciência da Operação (210210)...');

    // RES_NFE cuja chave ainda não tem Ciência ENVIADA — verificado via relação (evita notIn em escala)
    const where: Prisma.DfeDocumentoWhereInput = {
      tipoDocumento: DfeTipoDocumento.RES_NFE,
      chaveAcesso: { not: null },
      NOT: {
        manifestacoes: {
          some: { tpEvento: '210210', status: DfeManifestacaoStatus.ENVIADO },
        },
      },
    };
    if (filtro?.tenantId) where.tenantId = filtro.tenantId;
    if (filtro?.cnpj) where.cnpjDestinatario = filtro.cnpj;

    const documentos = await this.prisma.dfeDocumento.findMany({
      where,
      select: { id: true, tenantId: true },
      take: 50,
      orderBy: { criadoEm: 'asc' },
    });

    if (documentos.length === 0) {
      this.logger.debug('Nenhum RES_NFE pendente de Ciência.');
      return;
    }

    this.logger.log(`${documentos.length} RES_NFE sem Ciência — processando...`);

    for (const doc of documentos) {
      try {
        await this.registrarEEnviar(doc.tenantId, {
          documentoId: doc.id,
          tpEvento: '210210',
        });
      } catch (err) {
        this.logger.error(
          `Falha ao enviar Ciência para documento ${doc.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Manifestação manual (210200 / 210220 / 210240)
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Envia manualmente uma manifestação do destinatário.
   * Restrito aos tipos que exigem ação humana: Confirmação (210200),
   * Operação não Realizada (210220) e Desconhecimento (210240).
   *
   * A Ciência (210210) é enviada automaticamente pelo job — não é um tipo manual.
   * Para 210220, `xJust` é obrigatória com mínimo de 15 caracteres.
   *
   * @throws BadRequestException para validações de negócio
   * @throws NotFoundException se o documento não pertencer ao tenant
   */
  async manifestarManual(
    tenantId: string,
    documentoId: string,
    tpEvento: '210200' | '210220' | '210240',
    xJust?: string,
  ) {
    return this.registrarEEnviar(tenantId, { documentoId, tpEvento, xJust });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Registrar e enviar
  // ────────────────────────────────────────────────────────────────────────────

  async registrarEEnviar(tenantId: string, dto: ManifestarDfeDto, usuarioId?: string) {
    try {
      return await this._registrarEEnviar(tenantId, dto, usuarioId);
    } catch (err) {
      // Re-throw NestJS HTTP exceptions (BadRequestException, NotFoundException) as-is
      if ((err as any)?.status) throw err;
      this.logger.error(
        `Erro inesperado em registrarEEnviar documentoId=${dto.documentoId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }
  }

  private async _registrarEEnviar(tenantId: string, dto: ManifestarDfeDto, usuarioId?: string) {
    const tipoEvento = Object.values(TIPO_EVENTO_MANIFESTACAO).find(
      (t) => t.codigo === dto.tpEvento,
    );
    if (!tipoEvento) {
      throw new BadRequestException(`Tipo de evento inválido: ${dto.tpEvento}`);
    }
    if (tipoEvento.exigeJustificativa && (!dto.xJust || dto.xJust.length < 15)) {
      throw new BadRequestException(
        'Justificativa obrigatória (mínimo 15 caracteres) para este tipo de evento.',
      );
    }

    const documento = await this.prisma.dfeDocumento.findFirst({
      where: { id: dto.documentoId, tenantId },
      select: { id: true, chaveAcesso: true, cnpjDestinatario: true, tipoDocumento: true },
    });
    if (!documento) throw new NotFoundException('Documento DFe não encontrado');
    if (!documento.chaveAcesso) {
      throw new BadRequestException('Documento não possui chave de acesso (não é uma NF-e)');
    }

    // O evento pertence à NF-e, não ao RES_NFE — preferir PROC_NFE como documentoId
    const procNfe =
      documento.tipoDocumento !== DfeTipoDocumento.PROC_NFE
        ? await this.prisma.dfeDocumento.findFirst({
            where: { tenantId, chaveAcesso: documento.chaveAcesso, tipoDocumento: DfeTipoDocumento.PROC_NFE },
            select: { id: true },
          })
        : null;
    const manifestacaoDocumentoId = procNfe?.id ?? documento.id;

    const config = await this.prisma.dfeConfig.findFirst({
      where: { tenantId, cnpj: documento.cnpjDestinatario, ativo: true },
      select: { id: true, cnpj: true, cUf: true, tpAmb: true, certificadoId: true },
    });
    if (!config) {
      throw new NotFoundException(
        `Nenhuma configuração DFe ativa para CNPJ ${documento.cnpjDestinatario}`,
      );
    }

    // Para manifestações do destinatário, a SEFAZ aceita apenas nSeqEvento=1 por tipo.
    // Se já existe um evento ENVIADO do mesmo tipo para esta chave, retorna idempotente.
    const jaEnviado = await this.prisma.dfeManifestacao.findFirst({
      where: {
        tenantId,
        chaveAcesso: documento.chaveAcesso,
        tpEvento: dto.tpEvento,
        status: DfeManifestacaoStatus.ENVIADO,
      },
      select: { id: true },
    });
    if (jaEnviado) {
      this.logger.debug(
        `Manifestação ${dto.tpEvento} já ENVIADA para chave ...${documento.chaveAcesso.slice(-6)} — retornando existente`,
      );
      return this.prisma.dfeManifestacao.findUniqueOrThrow({ where: { id: jaEnviado.id } });
    }

    // nSeqEvento = 1 para primeira tentativa aceita pela SEFAZ.
    // Tentativas rejeitadas (REJEITADO/ERRO) não incrementam — SEFAZ não registrou esses eventos.
    const nSeqEvento = 1;

    // SEFAZ exige dhEvento sem milissegundos e com offset Brasil (UTC-3)
    // XSD TDateTimeUTC: YYYY-MM-DDTHH:MM:SS-03:00
    const now = new Date();
    const brazilTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const dhEvento = brazilTime.toISOString().replace(/\.\d{3}Z$/, '-03:00');
    const idLote = String(Date.now()).substring(0, 15);

    // Se já existe um registro não-ENVIADO com o mesmo nSeqEvento (tentativa anterior rejeitada),
    // reutiliza o registro existente em vez de criar um novo (evita violar unique constraint
    // e evita que SEFAZ receba nSeqEvento fora de sequência em tentativas subsequentes).
    const registroExistente = await this.prisma.dfeManifestacao.findFirst({
      where: {
        tenantId,
        chaveAcesso: documento.chaveAcesso,
        tpEvento: dto.tpEvento,
        nSeqEvento,
        status: { not: DfeManifestacaoStatus.ENVIADO },
      },
      select: { id: true },
    });

    const manifestacao = registroExistente
      ? await this.prisma.dfeManifestacao.update({
          where: { id: registroExistente.id },
          data: {
            status: DfeManifestacaoStatus.PENDENTE,
            documentoId: manifestacaoDocumentoId,
            xJust: dto.xJust,
          },
        })
      : await this.prisma.dfeManifestacao.create({
          data: {
            tenantId,
            cnpj: config.cnpj,
            documentoId: manifestacaoDocumentoId,
            chaveAcesso: documento.chaveAcesso,
            tpEvento: dto.tpEvento,
            xEvento: tipoEvento.xEvento,
            nSeqEvento,
            xJust: dto.xJust,
            status: DfeManifestacaoStatus.PENDENTE,
          },
        });

    // Envia imediatamente
    await this.enviar(manifestacao.id, {
      tenantId,
      configId: config.id,
      cnpj: config.cnpj,
      cUf: config.cUf,
      tpAmb: config.tpAmb as 1 | 2,
      chaveAcesso: documento.chaveAcesso,
      tpEvento: dto.tpEvento,
      xEvento: tipoEvento.xEvento,
      descEvento: tipoEvento.descEvento,
      nSeqEvento,
      xJust: dto.xJust,
      dhEvento,
      idLote,
    });

    this.auditoria.gravar({
      tenantId,
      entidadeTipo: 'CertificadoDigital',
      entidadeId: config.certificadoId,
      acao: AuditAcao.USO,
      usuarioId,
      payloadDepois: {
        processo: 'Manifestação DFe',
        operacao: tipoEvento.xEvento,
        cnpj: config.cnpj,
        chaveAcesso: documento.chaveAcesso,
        documentoId: dto.documentoId,
      },
    }).catch((err) => this.logger.error('Falha ao gravar audit de manifestação DFe', err));

    return this.prisma.dfeManifestacao.findUniqueOrThrow({ where: { id: manifestacao.id } });
  }

  private async enviar(
    manifestacaoId: string,
    params: {
      tenantId: string;
      configId: string;
      cnpj: string;
      cUf: number;
      tpAmb: 1 | 2;
      chaveAcesso: string;
      tpEvento: import('./dfe.types').TipoEventoManifestacaoCodigo;
      xEvento: string;
      descEvento: string;
      nSeqEvento: number;
      xJust?: string;
      dhEvento: string;
      idLote: string;
    },
  ): Promise<void> {
    let pemCert: string;
    let pemKey: string;

    try {
      const cert = await this.certLoader.loadCert(params.tenantId, params.configId);
      pemCert = cert.pemCert;
      pemKey = cert.pemKey;
    } catch (err) {
      const msg = `Falha ao carregar certificado: ${(err as Error).message}`;
      await this.registrarErro(manifestacaoId, msg);
      this.logger.error(`Manifestação ${manifestacaoId}: ${msg}`);
      return;
    }

    try {
      const ret = await this.soapClient.enviarManifestacao(
        {
          cnpj: params.cnpj,
          cUf: params.cUf,
          tpAmb: params.tpAmb,
          chNFe: params.chaveAcesso,
          tpEvento: params.tpEvento,
          xEvento: params.xEvento,
          descEvento: params.descEvento,
          nSeqEvento: params.nSeqEvento,
          xJust: params.xJust,
          dhEvento: params.dhEvento,
          idLote: params.idLote,
        },
        pemCert,
        pemKey,
      );

      const retEvento = ret.retEvento?.[0];
      const cStat = retEvento?.cStat ?? ret.cStat;
      const nProt = retEvento?.nProt;
      const xMotivo = retEvento?.xMotivo ?? ret.xMotivo;
      const dhRegEvento = retEvento?.dhRegEvento
        ? new Date(retEvento.dhRegEvento)
        : undefined;

      // cStat=573 significa que o evento já estava registrado na SEFAZ (qualquer tipo).
      // O evento existe lá — sincroniza como ENVIADO independente do tpEvento.
      const sucesso =
        cStat === CSTAT.EVENTO_REGISTRADO ||
        cStat === CSTAT.EVENTO_VINCULADO ||
        cStat === CSTAT.DUPLICIDADE_EVENTO;

      await this.prisma.dfeManifestacao.update({
        where: { id: manifestacaoId },
        data: {
          status: sucesso
            ? DfeManifestacaoStatus.ENVIADO
            : DfeManifestacaoStatus.REJEITADO,
          tentativas: { increment: 1 },
          cStat,
          xMotivo,
          nProt: nProt ?? null,
          dhRegEvento: dhRegEvento ?? null,
          enviadoEm: new Date(),
        },
      });

      // cStat=573: o evento JÁ está registrado na SEFAZ para esta chave.
      // Atualiza TODOS os registros não-ENVIADO da mesma (chaveAcesso, tpEvento)
      // para ENVIADO — garante que registros anteriores com status REJEITADO/ERRO
      // reflitam corretamente o estado real no AN.
      if (cStat === CSTAT.DUPLICIDADE_EVENTO) {
        await this.prisma.dfeManifestacao.updateMany({
          where: {
            tenantId: params.tenantId,
            chaveAcesso: params.chaveAcesso,
            tpEvento: params.tpEvento,
            status: { not: DfeManifestacaoStatus.ENVIADO },
          },
          data: {
            status: DfeManifestacaoStatus.ENVIADO,
            cStat,
            xMotivo,
            enviadoEm: new Date(),
          },
        });
        this.logger.log(
          `cStat=573: sincronizou todos os registros da chave ...${params.chaveAcesso.slice(-6)} tpEvento=${params.tpEvento} para ENVIADO`,
        );
      }

      await this.nsuRepo.registrarAuditoria({
        tenantId: params.tenantId,
        cnpj: params.cnpj,
        operacao: sucesso ? 'MANIFESTACAO_ENVIADA' : 'MANIFESTACAO_REJEITADA',
        sucesso,
        cStat,
        detalhe: `tpEvento=${params.tpEvento} nSeq=${params.nSeqEvento} nProt=${nProt ?? '-'} xMotivo=${xMotivo}`,
      });

      if (sucesso) {
        this.logger.log(
          `Manifestação ${manifestacaoId} registrada: nProt=${nProt} cStat=${cStat}`,
        );
      } else {
        this.logger.warn(
          `Manifestação ${manifestacaoId} rejeitada: cStat=${cStat} xMotivo=${xMotivo}`,
        );
      }
    } catch (err) {
      const msg = (err as Error).message;
      await this.registrarErro(manifestacaoId, msg);
      this.logger.error(`Manifestação ${manifestacaoId} erro de rede/SOAP: ${msg}`, (err as Error).stack);
    }
  }

  private async registrarErro(manifestacaoId: string, mensagem: string): Promise<void> {
    try {
      await this.prisma.dfeManifestacao.update({
        where: { id: manifestacaoId },
        data: {
          status: DfeManifestacaoStatus.ERRO,
          tentativas: { increment: 1 },
          erroMensagem: mensagem.slice(0, 2000),
        },
      });
    } catch (e) {
      this.logger.error(`Falha ao registrar erro de manifestação ${manifestacaoId}: ${(e as Error).message}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Listagem
  // ────────────────────────────────────────────────────────────────────────────

  async listar(
    tenantId: string,
    params: {
      cnpj?: string;
      status?: string;
      documentoId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { page, limit, skip } = parsePagination(params);

    const where: Record<string, any> = { tenantId };
    if (params.cnpj) where['cnpj'] = params.cnpj;
    if (params.status) where['status'] = params.status;
    if (params.documentoId) where['documentoId'] = params.documentoId;

    const [total, manifestacoes] = await Promise.all([
      this.prisma.dfeManifestacao.count({ where }),
      this.prisma.dfeManifestacao.findMany({
        where,
        select: {
          id: true,
          cnpj: true,
          documentoId: true,
          chaveAcesso: true,
          tpEvento: true,
          xEvento: true,
          nSeqEvento: true,
          xJust: true,
          status: true,
          tentativas: true,
          nProt: true,
          cStat: true,
          xMotivo: true,
          dhRegEvento: true,
          criadoEm: true,
          enviadoEm: true,
        },
        orderBy: { criadoEm: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: manifestacoes,
      meta: buildMeta(total, page, limit),
    };
  }
}
