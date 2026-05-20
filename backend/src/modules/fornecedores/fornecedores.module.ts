import { Module } from '@nestjs/common';
import { FornecedoresService } from './fornecedores.service';
import { FornecedoresController } from './fornecedores.controller';
import { FornecedorAccessGuard } from './guards/fornecedor-access.guard';
import { AuditoriaModule } from '../auditoria/auditoria.module';
import { BrasilApiModule } from '../../common/brasil-api/brasil-api.module';
import { FornecedorRepository } from './fornecedor.repository';

@Module({
  imports: [AuditoriaModule, BrasilApiModule],
  providers: [FornecedorRepository, FornecedoresService, FornecedorAccessGuard],
  controllers: [FornecedoresController],
  exports: [FornecedoresService],
})
export class FornecedoresModule {}
