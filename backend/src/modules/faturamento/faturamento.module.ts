import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { FaturamentoGcsService } from './faturamento-gcs.service';
import { FaturamentoProcessamentoService } from './faturamento-processamento.service';
import { FaturamentoQueryService } from './faturamento-query.service';
import { FaturamentoCanceladosService } from './faturamento-cancelados.service';
import { FaturamentoController } from './faturamento.controller';

@Module({
  imports: [PrismaModule],
  providers: [FaturamentoGcsService, FaturamentoQueryService, FaturamentoProcessamentoService, FaturamentoCanceladosService],
  controllers: [FaturamentoController],
  exports: [FaturamentoProcessamentoService, FaturamentoQueryService, FaturamentoGcsService],
})
export class FaturamentoModule {}
