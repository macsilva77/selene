import { Module } from '@nestjs/common';
import { EmpresasService } from './empresas.service';
import { EmpresasController } from './empresas.controller';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { BrasilApiModule } from '../../common/brasil-api/brasil-api.module';
import { EmpresaRepository } from './empresa.repository';

@Module({
  imports: [AuditoriaModule, BrasilApiModule],
  providers: [EmpresaRepository, EmpresasService],
  controllers: [EmpresasController],
  exports: [EmpresasService],
})
export class EmpresasModule {}
