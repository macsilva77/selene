import { Module } from '@nestjs/common';
import { CertificadosExpiryJob } from './certificados-expiry.job';
import { AuditoriaModule } from '../modules/auditoria/auditoria.module';

@Module({
  imports: [AuditoriaModule],
  providers: [CertificadosExpiryJob],
})
export class JobsModule {}
