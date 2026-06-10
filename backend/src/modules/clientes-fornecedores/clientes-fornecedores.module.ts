import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
// Reutiliza o DuckDbService do módulo de análise de crédito (sem duplicar a classe).
// NestJS cria uma instância isolada para este módulo — o DuckDB in-memory é independente.
import { DuckDbService } from '../analise-credito/infrastructure/duckdb/duckdb.service';
import { ClientesFornecedoresGcsService } from './gcs/clientes-fornecedores-gcs.service';
import { ClientesFornecedoresParquetWriter } from './parquet/clientes-fornecedores-parquet.writer';
import { ClientesFornecedoresProcessamentoService } from './clientes-fornecedores-processamento.service';
import { ClientesFornecedoresPubSubConsumer } from './clientes-fornecedores-pubsub.consumer';
import { ClientesFornecedoresParquetRepository } from './query/clientes-fornecedores-parquet.repository';
import { ClientesFornecedoresQueryService } from './query/clientes-fornecedores-query.service';
import { ClientesFornecedoresExcelService } from './excel/clientes-fornecedores-excel.service';
import { ClientesFornecedoresController } from './clientes-fornecedores.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ClientesFornecedoresController],
  providers: [
    DuckDbService,
    ClientesFornecedoresGcsService,
    ClientesFornecedoresParquetWriter,
    ClientesFornecedoresProcessamentoService,
    ClientesFornecedoresPubSubConsumer,
    ClientesFornecedoresParquetRepository,
    ClientesFornecedoresQueryService,
    ClientesFornecedoresExcelService,
  ],
  exports: [
    ClientesFornecedoresProcessamentoService,
    ClientesFornecedoresQueryService,
  ],
})
export class ClientesFornecedoresModule {}
