import { Module } from '@nestjs/common';
import { CertificadosService } from './certificados.service';
import { CertificadosController } from './certificados.controller';
import { AuditoriaModule } from '../auditoria/auditoria.module';

@Module({
  imports: [AuditoriaModule],
  providers: [CertificadosService],
  controllers: [CertificadosController],
  exports: [CertificadosService],
})
export class CertificadosModule {}
