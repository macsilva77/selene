import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { DfeDistribuicaoService } from './dfe-distribuicao.service';
import { DfeDistribuicaoController } from './dfe-distribuicao.controller';
import { DfeCertLoaderService } from './dfe-cert-loader.service';
import { DfeSoapClientService } from './dfe-soap-client.service';
import { DfeNsuControlRepository } from './dfe-nsu-control.repository';
import { DfeNsuRedisRepository } from './dfe-nsu-redis.repository';
import { DfeXmlProcessorService } from './dfe-xml-processor.service';
import { DfeGapDetectorService } from './dfe-gap-detector.service';
import { DfeXmlSignerService } from './dfe-xml-signer.service';
import { DfeManifestacaoService } from './dfe-manifestacao.service';
import { DfeDownloadService } from './dfe-download.service';
import { DfeMetricsService } from './dfe-metrics.service';
import { DfeDanfeService, DANFE_EXPORT_QUEUE } from './dfe-danfe.service';
import { DfeVarreduraService } from './dfe-varredura.service';
import { DfeStorageService } from './dfe-storage.service';
import { DfePubSubService } from './dfe-pubsub.service';
import {
  DFE_RESUMO_QUEUE,
  DFE_CIENCIA_QUEUE,
  DFE_DOWNLOAD_QUEUE,
  DFE_GAP_QUEUE,
  DFE_VARREDURA_QUEUE,
} from './dfe-queue.constants';

/**
 * Módulo de serviços DFe — usado pela API e pelo Worker.
 *
 * Contém apenas serviços e registros de fila (sem @Processor e sem @Cron).
 * Os workers e schedulers ficam em DfeDistribuicaoWorkerModule, que é
 * importado exclusivamente pelo processo Worker.
 */
@Module({
  imports: [
    AuditoriaModule,
    BullModule.registerQueue({ name: DANFE_EXPORT_QUEUE }),
    BullModule.registerQueue({ name: DFE_RESUMO_QUEUE }),
    BullModule.registerQueue({ name: DFE_CIENCIA_QUEUE }),
    BullModule.registerQueue({ name: DFE_DOWNLOAD_QUEUE }),
    BullModule.registerQueue({ name: DFE_GAP_QUEUE }),
    BullModule.registerQueue({ name: DFE_VARREDURA_QUEUE }),
  ],
  controllers: [DfeDistribuicaoController],
  providers: [
    DfeDistribuicaoService,
    DfeManifestacaoService,
    DfeDownloadService,
    DfeCertLoaderService,
    DfeSoapClientService,
    DfeNsuControlRepository,
    DfeNsuRedisRepository,
    DfeXmlProcessorService,
    DfeGapDetectorService,
    DfeXmlSignerService,
    DfeMetricsService,
    DfeDanfeService,
    DfeVarreduraService,
    DfeStorageService,
    DfePubSubService,
  ],
  exports: [
    DfeDistribuicaoService,
    DfeManifestacaoService,
    DfeCertLoaderService,
    DfeSoapClientService,
    DfeXmlProcessorService,
    DfeGapDetectorService,
    DfeXmlSignerService,
    DfeMetricsService,
    DfeDanfeService,
    DfeVarreduraService,
    DfeNsuRedisRepository,
    DfeStorageService,
    DfePubSubService,
  ],
})
export class DfeDistribuicaoModule {}
