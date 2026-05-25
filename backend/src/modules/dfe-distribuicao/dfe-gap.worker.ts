import { Logger } from '@nestjs/common';
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { DfeGapStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { DfeCertLoaderService } from './dfe-cert-loader.service';
import { DfeSoapClientService } from './dfe-soap-client.service';
import { DfeXmlProcessorService } from './dfe-xml-processor.service';
import { DfeNsuRedisRepository } from './dfe-nsu-redis.repository';
import { CSTAT } from './dfe.types';
import { DFE_GAP_QUEUE, DfeGapJobData } from './dfe-queue.constants';

const GAP_INCLUDE = {
  config: { select: { id: true, tenantId: true, cnpj: true, tpAmb: true, cUf: true } },
} satisfies Prisma.DfeGapNsuInclude;

type GapComConfig = NonNullable<Prisma.DfeGapNsuGetPayload<{ include: typeof GAP_INCLUDE }>>;

/**
 * Worker do job dfe:gap — recuperação de NSU individual via consNSU.
 *
 * Responsabilidades:
 *  1. Carrega certificado mTLS do tenant.
 *  2. Chama consultarNSU() com o NSU faltante.
 *  3. cStat=138 → cria lote de recovery + processa documentos → status=RECUPERADO.
 *  4. cStat=137 → NSU inexistente → status=INEXISTENTE.
 *  5. Erros transientes → lança exceção para BullMQ retentar com backoff.
 *     Na última tentativa → status=ESGOTADO sem relançar (sem nova retentativa).
 */
@Processor(DFE_GAP_QUEUE)
export class DfeGapWorker {
  private readonly logger = new Logger(DfeGapWorker.name);

  /** Deve bater com `attempts` configurado ao enfileirar o job. */
  private readonly MAX_TENTATIVAS = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly certLoader: DfeCertLoaderService,
    private readonly soapClient: DfeSoapClientService,
    private readonly xmlProcessor: DfeXmlProcessorService,
    private readonly nsuRepo: DfeNsuRedisRepository,
  ) {}

  @Process({ concurrency: 5 })
  async handle(job: Job<DfeGapJobData>): Promise<void> {
    const { tenantId, gapId } = job.data;

    const gap = await this.prisma.dfeGapNsu.findUnique({
      where: { id: gapId },
      include: GAP_INCLUDE,
    });

    if (!gap || gap.status !== DfeGapStatus.PENDENTE) {
      this.logger.debug(`[gap] gapId=${gapId} ignorado — status=${gap?.status ?? 'não encontrado'}`);
      return;
    }

    const { config, nsuFaltante } = gap;
    const inicio = Date.now();

    this.logger.log(`[gap] gapId=${gapId} NSU=${nsuFaltante} CNPJ=${config.cnpj}`);

    let pemCert: string;
    let pemKey: string;
    try {
      const cert = await this.certLoader.loadCert(tenantId, config.id);
      pemCert = cert.pemCert;
      pemKey = cert.pemKey;
    } catch (err) {
      await this.tratarErro(job, gap, `Falha ao carregar certificado: ${(err as Error).message}`);
      return;
    }

    try {
      await this.nsuRepo.aguardarRateLimit(tenantId, config.cnpj);
    } catch (err) {
      throw new Error((err as Error).message, { cause: err }); // BullMQ retenta com backoff
    }

    let ret: Awaited<ReturnType<typeof this.soapClient.consultarNSU>>;
    try {
      ret = await this.soapClient.consultarNSU(
        { cnpj: config.cnpj, cUf: config.cUf, tpAmb: config.tpAmb as 1 | 2, nsu: nsuFaltante },
        pemCert,
        pemKey,
      );
    } catch (err) {
      await this.tratarErro(job, gap, (err as Error).message, undefined, Date.now() - inicio);
      return;
    }

    const duracaoMs = Date.now() - inicio;
    const cStat = String(ret.cStat);

    if (cStat === String(CSTAT.DOCUMENTOS_LOCALIZADOS)) {
      await this.marcarRecuperado(gap, ret, duracaoMs);
      return;
    }

    if (cStat === String(CSTAT.NENHUM_DOCUMENTO)) {
      await this.marcarInexistente(gap, cStat, duracaoMs);
      return;
    }

    this.logger.warn(`[gap] gapId=${gapId} cStat inesperado=${cStat} "${ret.xMotivo}"`);
    await this.tratarErro(job, gap, `cStat inesperado: ${cStat} — ${ret.xMotivo}`, cStat, duracaoMs);
  }

  // ──────────────────────────────────────────────────────────────────────────

  private async marcarRecuperado(
    gap: GapComConfig,
    ret: import('./dfe.types').RetDistDFeInt,
    duracaoMs: number,
  ): Promise<void> {
    const { id, tenantId, nsuFaltante, config } = gap;
    let documentoId: string | undefined;

    if (ret.documentos?.length) {
      const controle = await this.prisma.dfeNsuControle.findUnique({
        where: { configId: config.id },
        select: { id: true },
      });

      if (controle) {
        const lote = await this.prisma.dfeLote.create({
          data: {
            controleId: controle.id,
            tenantId,
            cnpj: config.cnpj,
            nsuEnviado: nsuFaltante,
            cStat: String(CSTAT.DOCUMENTOS_LOCALIZADOS),
            xMotivo: 'Recuperação de gap NSU',
            ultNsuRecebido: nsuFaltante,
            maxNsuRecebido: ret.maxNSU ?? nsuFaltante,
            qtdDocumentos: ret.documentos.length,
          },
        });

        for (const docRaw of ret.documentos) {
          const doc = await this.xmlProcessor.processarDocumento(
            docRaw,
            lote.id,
            tenantId,
            config.cnpj,
          );
          if (doc?.id) documentoId = doc.id;
        }
      }
    }

    await this.prisma.dfeGapNsu.update({
      where: { id },
      data: {
        status: DfeGapStatus.RECUPERADO,
        recuperadoEm: new Date(),
        ...(documentoId ? { documentoId } : {}),
      },
    });

    await this.nsuRepo.registrarAuditoria({
      tenantId,
      cnpj: config.cnpj,
      operacao: 'RECOVERY_GAP_OK',
      nsuDepois: nsuFaltante,
      cStat: String(CSTAT.DOCUMENTOS_LOCALIZADOS),
      sucesso: true,
      detalhe: `Gap NSU=${nsuFaltante} recuperado. documentoId=${documentoId ?? 'nenhum'}`,
      duracaoMs,
    });

    this.logger.log(`[gap] id=${id} NSU=${nsuFaltante} RECUPERADO`);
  }

  private async marcarInexistente(
    gap: GapComConfig,
    cStat: string,
    duracaoMs: number,
  ): Promise<void> {
    const { id, tenantId, nsuFaltante, config } = gap;

    await this.prisma.dfeGapNsu.update({
      where: { id },
      data: { status: DfeGapStatus.INEXISTENTE },
    });

    await this.nsuRepo.registrarAuditoria({
      tenantId,
      cnpj: config.cnpj,
      operacao: 'RECOVERY_GAP_INEXISTENTE',
      nsuDepois: nsuFaltante,
      cStat,
      sucesso: true,
      detalhe: `NSU=${nsuFaltante} inexistente no AN (cStat=137).`,
      duracaoMs,
    });

    this.logger.log(`[gap] id=${id} NSU=${nsuFaltante} INEXISTENTE`);
  }

  private async tratarErro(
    job: Job<DfeGapJobData>,
    gap: GapComConfig,
    mensagem: string,
    cStat?: string,
    duracaoMs?: number,
  ): Promise<void> {
    const { id, tenantId, nsuFaltante, config } = gap;
    const tentativaAtual = job.attemptsMade + 1;
    const isUltima = tentativaAtual >= this.MAX_TENTATIVAS;

    await this.prisma.dfeGapNsu.update({
      where: { id },
      data: {
        tentativas: tentativaAtual,
        status: isUltima ? DfeGapStatus.ESGOTADO : DfeGapStatus.PENDENTE,
      },
    });

    await this.nsuRepo.registrarAuditoria({
      tenantId,
      cnpj: config.cnpj,
      operacao: isUltima ? 'RECOVERY_GAP_ESGOTADO' : 'RECOVERY_GAP_ERRO',
      nsuDepois: nsuFaltante,
      ...(cStat ? { cStat } : {}),
      sucesso: false,
      detalhe: `Tentativa ${tentativaAtual}/${this.MAX_TENTATIVAS}: ${mensagem}`,
      duracaoMs,
    });

    if (isUltima) {
      this.logger.warn(`[gap] id=${id} NSU=${nsuFaltante} ESGOTADO após ${tentativaAtual} tentativas`);
      // Não lança — BullMQ encerra o job sem nova retentativa
      return;
    }

    this.logger.warn(
      `[gap] id=${id} NSU=${nsuFaltante} erro (tentativa ${tentativaAtual}/${this.MAX_TENTATIVAS}) — será retentado`,
    );
    throw new Error(`Gap recovery falhou: ${mensagem}`);
  }
}
