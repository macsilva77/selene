import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { FaturamentoModule } from '../faturamento/faturamento.module';
import { EstoqueCombustivelService } from './estoque-combustivel.service';
import { EstoqueFiscalService } from './estoque-fiscal.service';
import { EstoqueController } from './estoque.controller';

@Module({
  imports: [PrismaModule, FaturamentoModule],
  providers: [EstoqueCombustivelService, EstoqueFiscalService],
  controllers: [EstoqueController],
})
export class EstoqueModule {}
