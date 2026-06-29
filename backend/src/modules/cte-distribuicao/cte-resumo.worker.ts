import { Logger } from '@nestjs/common';
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { CteDistribuicaoService } from './cte-distribuicao.service';
import { CTE_RESUMO_QUEUE, CteResumoJobData } from './cte-queue.constants';

/**
 * Worker do job cte:resumo — por CNPJ.
 *
 * Chama a SEFAZ via sincronizarCte() (distNSU) e persiste os documentos.
 * Diferente da NF-e, não há etapa de ciência/download: o CT-e é entregue
 * completo na distribuição.
 */
@Processor(CTE_RESUMO_QUEUE)
export class CteResumoWorker {
  private readonly logger = new Logger(CteResumoWorker.name);

  constructor(private readonly distribuicaoService: CteDistribuicaoService) {}

  @Process({ concurrency: 2 })
  async handle(job: Job<CteResumoJobData>): Promise<void> {
    const { cnpj, configId, force } = job.data;
    const inicio = Date.now();

    this.logger.log(`[cte:resumo] iniciando CNPJ=${cnpj} configId=${configId} force=${force ?? false}`);

    await this.distribuicaoService.sincronizarCte(configId, undefined, force ?? false);

    this.logger.log(`[cte:resumo] concluído CNPJ=${cnpj} em ${Date.now() - inicio}ms`);
  }
}
