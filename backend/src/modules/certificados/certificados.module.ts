import { Module } from '@nestjs/common';
import { CertificadosService } from './certificados.service';
import { CertificadosController } from './certificados.controller';
import { InternalCertificadosController } from './internal-certificados.controller';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { PubSubService } from '../../common/services/pubsub.service';

@Module({
  imports: [AuditoriaModule],
  providers: [CertificadosService, PubSubService],
  controllers: [CertificadosController, InternalCertificadosController],
  exports: [CertificadosService],
})
export class CertificadosModule {}
