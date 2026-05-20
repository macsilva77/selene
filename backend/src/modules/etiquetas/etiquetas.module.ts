import { Module } from '@nestjs/common';
import { EtiquetasService } from './etiquetas.service';
import { EtiquetasController } from './etiquetas.controller';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { EtiquetaRepository } from './etiqueta.repository';

@Module({
  imports: [AuditoriaModule],
  providers: [EtiquetaRepository, EtiquetasService],
  controllers: [EtiquetasController],
  exports: [EtiquetasService],
})
export class EtiquetasModule {}
