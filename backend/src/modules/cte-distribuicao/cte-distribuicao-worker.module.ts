import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { CteDistribuicaoModule } from './cte-distribuicao.module';
import { CteResumoWorker } from './cte-resumo.worker';
import { CteGapWorker } from './cte-gap.worker';
import { CteDistribuicaoJob } from './cte-distribuicao.job';
import { CteGapRecoveryJob } from './cte-gap-recovery.job';
import { CTE_RESUMO_QUEUE, CTE_GAP_QUEUE } from './cte-queue.constants';

/**
 * Módulo Worker do CT-e — registra @Processor e @Cron.
 * Importado exclusivamente pelo processo Worker. As filas são re-registradas
 * aqui para que os @InjectQueue dos schedulers funcionem neste escopo.
 */
@Module({
  imports: [
    CteDistribuicaoModule,
    BullModule.registerQueue({ name: CTE_RESUMO_QUEUE }),
    BullModule.registerQueue({ name: CTE_GAP_QUEUE }),
  ],
  providers: [CteResumoWorker, CteGapWorker, CteDistribuicaoJob, CteGapRecoveryJob],
})
export class CteDistribuicaoWorkerModule {}
