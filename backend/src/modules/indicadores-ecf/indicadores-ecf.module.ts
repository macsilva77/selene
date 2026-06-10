import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { IndicadoresEcfController } from './indicadores-ecf.controller';
import { IndicadoresEcfGcsService } from './indicadores-ecf-gcs.service';
import { IndicadoresEcfProcessamentoService } from './indicadores-ecf-processamento.service';

@Module({
  imports: [PrismaModule],
  controllers: [IndicadoresEcfController],
  providers: [IndicadoresEcfGcsService, IndicadoresEcfProcessamentoService],
})
export class IndicadoresEcfModule {}
