import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { CteDistribuicaoService } from './cte-distribuicao.service';
import { CteEventoService } from './cte-evento.service';
import { CteDistribuicaoController } from './cte-distribuicao.controller';
import { CteCertLoaderService } from './cte-cert-loader.service';
import { CteSoapClientService } from './cte-soap-client.service';
import { CteNsuControlRepository } from './cte-nsu-control.repository';
import { CteNsuRedisRepository } from './cte-nsu-redis.repository';
import { CteXmlProcessorService } from './cte-xml-processor.service';
import { CteGapDetectorService } from './cte-gap-detector.service';
import { CteXmlSignerService } from './cte-xml-signer.service';
import { CteStorageService } from './cte-storage.service';
import { CtePubSubService } from './cte-pubsub.service';
import { CTE_RESUMO_QUEUE, CTE_GAP_QUEUE } from './cte-queue.constants';

/**
 * Módulo de serviços de Distribuição CT-e — usado pela API e pelo Worker.
 * Contém apenas serviços e registros de fila (sem @Processor e sem @Cron).
 * Os workers e schedulers ficam em CteDistribuicaoWorkerModule.
 */
@Module({
  imports: [
    AuditoriaModule,
    BullModule.registerQueue({ name: CTE_RESUMO_QUEUE }),
    BullModule.registerQueue({ name: CTE_GAP_QUEUE }),
  ],
  controllers: [CteDistribuicaoController],
  providers: [
    CteDistribuicaoService,
    CteEventoService,
    CteCertLoaderService,
    CteSoapClientService,
    CteNsuControlRepository,
    CteNsuRedisRepository,
    CteXmlProcessorService,
    CteGapDetectorService,
    CteXmlSignerService,
    CteStorageService,
    CtePubSubService,
  ],
  exports: [
    CteDistribuicaoService,
    CteEventoService,
    CteCertLoaderService,
    CteSoapClientService,
    CteXmlProcessorService,
    CteGapDetectorService,
    CteXmlSignerService,
    CteNsuRedisRepository,
    CteStorageService,
    CtePubSubService,
  ],
})
export class CteDistribuicaoModule {}
