import { Logger } from '@nestjs/common';
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { CteGapStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CteCertLoaderService } from './cte-cert-loader.service';
import { CteSoapClientService } from './cte-soap-client.service';
import { CteXmlProcessorService } from './cte-xml-processor.service';
import { CteNsuRedisRepository } from './cte-nsu-redis.repository';
import { CSTAT, RetDistDFeInt } from './cte.types';
import { CTE_GAP_QUEUE, CteGapJobData } from './cte-queue.constants';

const GAP_INCLUDE = {
  config: { select: { id: true, tenantId: true, cnpj: true, tpAmb: true, cUf: true } },
} satisfies Prisma.CteGapNsuInclude;

type GapComConfig = NonNullable<Prisma.CteGapNsuGetPayload<{ include: typeof GAP_INCLUDE }>>;

/**
 * Worker do job cte:gap — recuperação de NSU individual via consNSU.
 *  - cStat=138 → cria lote de recovery + processa documentos → RECUPERADO.
 *  - cStat=137 → INEXISTENTE.
 *  - Erros transientes → relança para o Bull retentar; na última tentativa → ESGOTADO.
 */
@Processor(CTE_GAP_QUEUE)
export class CteGapWorker {
  private readonly logger = new Logger(CteGapWorker.name);

  private readonly MAX_TENTATIVAS = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly certLoader: CteCertLoaderService,
    private readonly soapClient: CteSoapClientService,
    private readonly xmlProcessor: CteXmlProcessorService,
    private readonly nsuRepo: CteNsuRedisRepository,
  ) {}

  @Process({ concurrency: 5 })
  async handle(job: Job<CteGapJobData>): Promise<void> {
    const { tenantId, gapId } = job.data;

    const gap = await this.prisma.cteGapNsu.findUnique({ where: { id: gapId }, include: GAP_INCLUDE });
    if (!gap || gap.status !== CteGapStatus.PENDENTE) {
      this.logger.debug(`[cte:gap] gapId=${gapId} ignorado — status=${gap?.status ?? 'não encontrado'}`);
      return;
    }

    const { config, nsuFaltante } = gap;
    const inicio = Date.now();

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
      throw new Error((err as Error).message, { cause: err });
    }

    let ret: RetDistDFeInt;
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

    if (cStat === CSTAT.DOCUMENTOS_LOCALIZADOS) {
      await this.marcarRecuperado(gap, ret, duracaoMs);
      return;
    }
    if (cStat === CSTAT.NENHUM_DOCUMENTO) {
      await this.marcarInexistente(gap, cStat, duracaoMs);
      return;
    }

    this.logger.warn(`[cte:gap] gapId=${gapId} cStat inesperado=${cStat} "${ret.xMotivo}"`);
    await this.tratarErro(job, gap, `cStat inesperado: ${cStat} — ${ret.xMotivo}`, cStat, duracaoMs);
  }

  private async marcarRecuperado(gap: GapComConfig, ret: RetDistDFeInt, duracaoMs: number): Promise<void> {
    const { id, tenantId, nsuFaltante, config } = gap;
    let documentoId: string | undefined;

    if (ret.documentos?.length) {
      const controle = await this.prisma.cteNsuControle.findUnique({
        where: { configId: config.id },
        select: { id: true },
      });

      if (controle) {
        const lote = await this.prisma.cteLote.create({
          data: {
            controleId: controle.id,
            tenantId,
            cnpj: config.cnpj,
            nsuEnviado: nsuFaltante,
            cStat: CSTAT.DOCUMENTOS_LOCALIZADOS,
            xMotivo: 'Recuperação de gap NSU',
            ultNsuRecebido: nsuFaltante,
            maxNsuRecebido: ret.maxNSU ?? nsuFaltante,
            qtdDocumentos: ret.documentos.length,
          },
        });

        for (const docRaw of ret.documentos) {
          const doc = await this.xmlProcessor.processarDocumento(docRaw, lote.id, tenantId, config.cnpj);
          if (doc?.id) documentoId = doc.id;
        }
      }
    }

    await this.prisma.cteGapNsu.update({
      where: { id },
      data: { status: CteGapStatus.RECUPERADO, recuperadoEm: new Date(), ...(documentoId ? { documentoId } : {}) },
    });

    await this.nsuRepo.registrarAuditoria({
      tenantId,
      cnpj: config.cnpj,
      operacao: 'RECOVERY_GAP_OK',
      nsuDepois: nsuFaltante,
      cStat: CSTAT.DOCUMENTOS_LOCALIZADOS,
      sucesso: true,
      detalhe: `Gap NSU=${nsuFaltante} recuperado. documentoId=${documentoId ?? 'nenhum'}`,
      duracaoMs,
    });

    this.logger.log(`[cte:gap] id=${id} NSU=${nsuFaltante} RECUPERADO`);
  }

  private async marcarInexistente(gap: GapComConfig, cStat: string, duracaoMs: number): Promise<void> {
    const { id, tenantId, nsuFaltante, config } = gap;

    await this.prisma.cteGapNsu.update({ where: { id }, data: { status: CteGapStatus.INEXISTENTE } });

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

    this.logger.log(`[cte:gap] id=${id} NSU=${nsuFaltante} INEXISTENTE`);
  }

  private async tratarErro(
    job: Job<CteGapJobData>,
    gap: GapComConfig,
    mensagem: string,
    cStat?: string,
    duracaoMs?: number,
  ): Promise<void> {
    const { id, tenantId, nsuFaltante, config } = gap;
    const tentativaAtual = job.attemptsMade + 1;
    const isUltima = tentativaAtual >= this.MAX_TENTATIVAS;

    await this.prisma.cteGapNsu.update({
      where: { id },
      data: { tentativas: tentativaAtual, status: isUltima ? CteGapStatus.ESGOTADO : CteGapStatus.PENDENTE },
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
      this.logger.warn(`[cte:gap] id=${id} NSU=${nsuFaltante} ESGOTADO após ${tentativaAtual} tentativas`);
      return;
    }

    this.logger.warn(`[cte:gap] id=${id} NSU=${nsuFaltante} erro (tentativa ${tentativaAtual}) — será retentado`);
    throw new Error(`Gap recovery falhou: ${mensagem}`);
  }
}
