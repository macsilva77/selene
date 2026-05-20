import { Module } from '@nestjs/common';
import { UnidadesOrganizacionaisService } from './unidades-organizacionais.service';
import { UnidadesOrganizacionaisController } from './unidades-organizacionais.controller';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { UnidadeOrganizacionalRepository } from './unidade-organizacional.repository';

@Module({
  imports: [AuditoriaModule],
  providers: [UnidadeOrganizacionalRepository, UnidadesOrganizacionaisService],
  controllers: [UnidadesOrganizacionaisController],
  exports: [UnidadesOrganizacionaisService],
})
export class UnidadesOrganizacionaisModule {}
