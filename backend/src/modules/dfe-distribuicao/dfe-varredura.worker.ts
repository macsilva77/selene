import { Logger } from '@nestjs/common';
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { DfeVarreduraService } from './dfe-varredura.service';
import { DFE_VARREDURA_QUEUE, DfeVarreduraJobData } from './dfe-queue.constants';

/**
 * Worker do job dfe:varredura — processa um lote de NSUs por varredura retroativa ativa.
 *
 * Cada execução processa LOTE_POR_CICLO=30 NSUs sequencialmente com delay de 200ms
 * entre chamadas (respeitando o rate-limit SEFAZ). O scheduler DfeVarreduraJob
 * enfileira um novo job a cada minuto para cada varredura ainda ativa.
 */
@Processor(DFE_VARREDURA_QUEUE)
export class DfeVarreduraWorker {
  private readonly logger = new Logger(DfeVarreduraWorker.name);

  constructor(private readonly varreduraService: DfeVarreduraService) {}

  @Process({ concurrency: 3 })
  async handle(job: Job<DfeVarreduraJobData>): Promise<void> {
    const { configId, cnpj } = job.data;

    this.logger.debug(`[varredura] iniciando lote configId=${configId} CNPJ=${cnpj}`);

    await this.varreduraService.executarLote(configId);
  }
}
