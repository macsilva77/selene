import { Module } from '@nestjs/common';
import { PerfisService } from './perfis.service';
import { PerfisController } from './perfis.controller';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { PerfilRepository } from './perfil.repository';

@Module({
  imports: [AuditoriaModule],
  providers: [PerfilRepository, PerfisService],
  controllers: [PerfisController],
  exports: [PerfisService],
})
export class PerfisModule {}
