import { Logger } from '@nestjs/common';
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { DfeDownloadService } from './dfe-download.service';
import { DfeNsuRedisRepository } from './dfe-nsu-redis.repository';
import { DfePubSubService } from './dfe-pubsub.service';
import { DFE_DOWNLOAD_QUEUE, DfeDownloadJobData } from './dfe-queue.constants';

/**
 * Worker do job dfe:download — por documento RES_NFE com Ciência enviada.
 *
 * Responsabilidades:
 *  1. Aguarda rate limit Redis (1 chamada SEFAZ/segundo por CNPJ).
 *  2. Baixa o XML completo (procNFe) via consChNFe.
 *  3. Persiste o PROC_NFE no banco/GCS (via DfeDownloadService).
 *  4. Emite evento Pub/Sub nfe-baixada em caso de sucesso.
 *
 * Resultado do download:
 *  - OK             → job concluído com sucesso
 *  - FALHA_PERMANENTE → job marcado como falha sem retentativa
 *  - ERRO_TRANSIENTE → lança erro para BullMQ retentar com backoff
 */
@Processor(DFE_DOWNLOAD_QUEUE)
export class DfeDownloadWorker {
  private readonly logger = new Logger(DfeDownloadWorker.name);

  constructor(
    private readonly downloadService: DfeDownloadService,
    private readonly nsuRepo: DfeNsuRedisRepository,
    private readonly pubSub: DfePubSubService,
  ) {}

  @Process({ concurrency: 3 })
  async handle(job: Job<DfeDownloadJobData>): Promise<void> {
    const { tenantId, cnpj, documentoId, chaveAcesso, nsu } = job.data;

    this.logger.debug(`[download] documentoId=${documentoId} chave=...${chaveAcesso.slice(-6)}`);

    try {
      await this.nsuRepo.aguardarRateLimit(tenantId, cnpj);
    } catch (err) {
      throw new Error((err as Error).message, { cause: err });
    }

    const resultado = await this.downloadService.executarDownload({
      documentoId,
      tenantId,
      chaveAcesso,
      cnpj,
      nsu,
    });

    if (resultado === 'OK') {
      this.logger.log(`[download] OK — doc=${documentoId} chave=...${chaveAcesso.slice(-6)}`);
      await this.pubSub.publicarNfeBaixada({ tenantId, cnpj, documentoId, chaveAcesso, nsu });
      return;
    }

    if (resultado === 'FALHA_PERMANENTE') {
      this.logger.warn(`[download] falha permanente — doc=${documentoId} — sem retentativa`);
      return;
    }

    throw new Error(`Download transiente falhou para doc=${documentoId} — será retentado`);
  }
}
