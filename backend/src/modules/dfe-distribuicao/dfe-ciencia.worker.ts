import { Logger } from '@nestjs/common';
import { Processor, Process, InjectQueue } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { DfeManifestacaoStatus } from '@prisma/client';
import { DfeManifestacaoService } from './dfe-manifestacao.service';
import { DfePubSubService } from './dfe-pubsub.service';
import {
  DFE_CIENCIA_QUEUE,
  DFE_DOWNLOAD_QUEUE,
  DfeCienciaJobData,
  DfeDownloadJobData,
  dfeJobId,
} from './dfe-queue.constants';

/**
 * Worker do job dfe:ciencia — por documento RES_NFE.
 *
 * Responsabilidades:
 *  1. Envia a Ciência da Operação (tpEvento=210210) para o documento.
 *  2. Se enviada com sucesso, emite evento Pub/Sub e enfileira dfe:download.
 *
 * Idempotente: se a Ciência já foi enviada (ENVIADO), enfileira download
 * diretamente sem chamar a SEFAZ novamente.
 */
@Processor(DFE_CIENCIA_QUEUE)
export class DfeCienciaWorker {
  private readonly logger = new Logger(DfeCienciaWorker.name);

  constructor(
    private readonly manifestacaoService: DfeManifestacaoService,
    private readonly pubSub: DfePubSubService,
    @InjectQueue(DFE_DOWNLOAD_QUEUE) private readonly downloadQueue: Queue<DfeDownloadJobData>,
  ) {}

  @Process({ concurrency: 3 })
  async handle(job: Job<DfeCienciaJobData>): Promise<void> {
    const { tenantId, cnpj, configId, documentoId, chaveAcesso } = job.data;

    this.logger.debug(`[ciencia] documentoId=${documentoId} chave=...${chaveAcesso.slice(-6)}`);

    const manifestacao = await this.manifestacaoService.registrarEEnviar(
      tenantId,
      { documentoId, tpEvento: '210210' },
    );

    const enviada = manifestacao.status === DfeManifestacaoStatus.ENVIADO;

    if (!enviada) {
      this.logger.warn(
        `[ciencia] status=${manifestacao.status} para doc=${documentoId} — download não enfileirado`,
      );
      throw new Error(`Ciência retornou status=${manifestacao.status} (cStat=${manifestacao.cStat ?? '?'})`);
    }

    this.logger.debug(`[ciencia] enviada com sucesso — enfileirando download doc=${documentoId}`);

    await this.pubSub.publicarCienciaEnviada({ tenantId, cnpj, documentoId, chaveAcesso });

    await this.enfileirarDownload({ tenantId, cnpj, configId, documentoId, chaveAcesso });
  }

  // ────────────────────────────────────────────────────────────────────────────

  private async enfileirarDownload(params: Omit<DfeDownloadJobData, 'nsu'>) {
    const { tenantId, documentoId } = params;
    const jobId = dfeJobId.download(tenantId, documentoId);

    const existente = await this.downloadQueue.getJob(jobId);
    if (existente) {
      const state = await existente.getState();
      if (state === 'waiting' || state === 'active' || state === 'delayed') return;
    }

    await this.downloadQueue.add(
      {
        tenantId: params.tenantId,
        cnpj: params.cnpj,
        configId: params.configId,
        documentoId: params.documentoId,
        chaveAcesso: params.chaveAcesso,
        nsu: '',
      },
      {
        jobId,
        attempts: 5,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: 200,
        removeOnFail: 100,
      },
    );
  }
}
