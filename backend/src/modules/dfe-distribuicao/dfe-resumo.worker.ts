import { Logger } from '@nestjs/common';
import { Processor, Process } from '@nestjs/bull';
import { InjectQueue } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { DfeManifestacaoStatus, DfeTipoDocumento } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { DfeDistribuicaoService } from './dfe-distribuicao.service';
import {
  DFE_RESUMO_QUEUE,
  DFE_CIENCIA_QUEUE,
  DfeResumoJobData,
  DfeCienciaJobData,
  dfeJobId,
} from './dfe-queue.constants';

/**
 * Worker do job dfe:resumo — por CNPJ.
 *
 * Responsabilidades:
 *  1. Chama SEFAZ via sincronizarDfe() (distNSU) e persiste documentos recebidos.
 *  2. Enfileira dfe:ciencia para cada RES_NFE sem Ciência enviada.
 *
 * O processamento real da SEFAZ permanece no DfeDistribuicaoService para que
 * a sincronização manual (via API) continue funcionando sem duplicar lógica.
 */
@Processor(DFE_RESUMO_QUEUE)
export class DfeResumoWorker {
  private readonly logger = new Logger(DfeResumoWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly distribuicaoService: DfeDistribuicaoService,
    @InjectQueue(DFE_CIENCIA_QUEUE) private readonly cienciaQueue: Queue<DfeCienciaJobData>,
  ) {}

  @Process({ concurrency: 2 })
  async handle(job: Job<DfeResumoJobData>): Promise<void> {
    const { tenantId, cnpj, configId, force } = job.data;
    const inicio = Date.now();

    this.logger.log(`[resumo] iniciando CNPJ=${cnpj} configId=${configId} force=${force ?? false}`);

    await this.distribuicaoService.sincronizarDfe(configId, undefined, force ?? false);

    const duracaoMs = Date.now() - inicio;
    this.logger.log(`[resumo] concluído CNPJ=${cnpj} em ${duracaoMs}ms — enfileirando ciência...`);

    await this.enfileirarCiencia(tenantId, cnpj, configId);
  }

  // ────────────────────────────────────────────────────────────────────────────

  private async enfileirarCiencia(tenantId: string, cnpj: string, configId: string): Promise<void> {
    const pendentes = await this.prisma.dfeDocumento.findMany({
      where: {
        tenantId,
        cnpjDestinatario: cnpj,
        tipoDocumento: DfeTipoDocumento.RES_NFE,
        chaveAcesso: { not: null },
        NOT: {
          manifestacoes: {
            some: { tpEvento: '210210', status: DfeManifestacaoStatus.ENVIADO },
          },
        },
      },
      select: { id: true, chaveAcesso: true },
      orderBy: { criadoEm: 'asc' },
      take: 200,
    });

    if (pendentes.length === 0) return;

    let enfileirados = 0;
    for (const doc of pendentes) {
      if (!doc.chaveAcesso) continue;

      const jobId = dfeJobId.ciencia(tenantId, doc.id);
      const existente = await this.cienciaQueue.getJob(jobId);
      if (existente) {
        const state = await existente.getState();
        if (state === 'waiting' || state === 'active' || state === 'delayed') continue;
      }

      await this.cienciaQueue.add(
        {
          tenantId,
          cnpj,
          configId,
          documentoId: doc.id,
          chaveAcesso: doc.chaveAcesso,
        },
        {
          jobId,
          attempts: 5,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: 200,
          removeOnFail: 100,
        },
      );
      enfileirados++;
    }

    if (enfileirados > 0) {
      this.logger.log(`[resumo] ${enfileirados} job(s) dfe:ciencia enfileirado(s) para CNPJ=${cnpj}`);
    }
  }
}
