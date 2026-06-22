import { Module } from '@nestjs/common';
import { CertificadosService } from './certificados.service';
import { CertificadosController } from './certificados.controller';
import { InternalCertificadosController } from './internal-certificados.controller';
import { CertificadoConvitesService } from './certificado-convites.service';
import { CertificadoConvitesController } from './certificado-convites.controller';
import { OnboardingController } from './onboarding.controller';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { MailModule } from '../../common/mail/mail.module';
import { PubSubService } from '../../common/services/pubsub.service';

@Module({
  imports: [AuditoriaModule, MailModule],
  providers: [CertificadosService, CertificadoConvitesService, PubSubService],
  controllers: [
    CertificadosController,
    InternalCertificadosController,
    CertificadoConvitesController,
    OnboardingController,
  ],
  exports: [CertificadosService],
})
export class CertificadosModule {}
