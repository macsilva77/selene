import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DfeDistribuicaoModule } from './dfe-distribuicao.module';
import { DfeResumoWorker } from './dfe-resumo.worker';
import { DfeCienciaWorker } from './dfe-ciencia.worker';
import { DfeGapWorker } from './dfe-gap.worker';
import { DfeDanfeProcessor } from './dfe-danfe.processor';
import { DfeDistribuicaoJob } from './dfe-distribuicao.job';
import { DfeGapRecoveryJob } from './dfe-gap-recovery.job';
import { DfeDownloadJob } from './dfe-download.job';
import { DANFE_EXPORT_QUEUE } from './dfe-danfe.service';
import {
  DFE_RESUMO_QUEUE,
  DFE_CIENCIA_QUEUE,
  DFE_GAP_QUEUE,
} from './dfe-queue.constants';

/**
 * Módulo Worker — registra todos os @Processor e @Cron do DFe.
 *
 * Importado exclusivamente pelo WorkerAppModule (processo worker separado).
 * O processo API importa apenas DfeDistribuicaoModule — sem workers nem schedulers.
 *
 * As filas são re-registradas aqui para que os @InjectQueue dos workers e
 * schedulers funcionem dentro do escopo deste módulo.
 */
@Module({
  imports: [
    DfeDistribuicaoModule,
    BullModule.registerQueue({ name: DANFE_EXPORT_QUEUE }),
    BullModule.registerQueue({ name: DFE_RESUMO_QUEUE }),
    BullModule.registerQueue({ name: DFE_CIENCIA_QUEUE }),
    BullModule.registerQueue({ name: DFE_GAP_QUEUE }),
  ],
  providers: [
    // @Processor workers — processam jobs das filas Bull
    DfeResumoWorker,
    DfeCienciaWorker,
    DfeGapWorker,
    DfeDanfeProcessor,
    // @Cron schedulers — enfileiram jobs periodicamente
    DfeDistribuicaoJob,
    DfeGapRecoveryJob,
    DfeDownloadJob,
  ],
})
export class DfeDistribuicaoWorkerModule {}
