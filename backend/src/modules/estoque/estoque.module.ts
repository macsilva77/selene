import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { FaturamentoModule } from '../faturamento/faturamento.module';
import { EstoqueCombustivelService } from './estoque-combustivel.service';
import { EstoqueController } from './estoque.controller';

@Module({
  imports: [PrismaModule, FaturamentoModule],
  providers: [EstoqueCombustivelService],
  controllers: [EstoqueController],
})
export class EstoqueModule {}
