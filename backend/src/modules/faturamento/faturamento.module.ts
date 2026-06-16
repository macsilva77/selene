import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { FaturamentoGcsService } from './faturamento-gcs.service';
import { FaturamentoProcessamentoService } from './faturamento-processamento.service';
import { FaturamentoController } from './faturamento.controller';

@Module({
  imports: [PrismaModule],
  providers: [FaturamentoGcsService, FaturamentoProcessamentoService],
  controllers: [FaturamentoController],
  exports: [FaturamentoProcessamentoService],
})
export class FaturamentoModule {}
