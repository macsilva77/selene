import { Module }                    from '@nestjs/common';
import { PrismaModule }              from '../../database/prisma.module';
// ── Infraestrutura ────────────────────────────────────────────────────────────
import { DuckDbService }             from './infrastructure/duckdb/duckdb.service';
import { EcfParquetRepository }      from './infrastructure/duckdb/ecf-parquet.repository';
import { ParquetCacheService }       from './infrastructure/cache/parquet-cache.service';
import { EcfDataSourceService }      from './infrastructure/ecf-data-source.service';
// ── P01 ───────────────────────────────────────────────────────────────────────
import { P01GcsService }             from './p01/p01-gcs.service';
import { P01Service }                from './p01/p01.service';
import { EcfParquetWriter }          from './p01/p01-ecf-parquet.writer';
// ── Leitura ECF (DRE + Balanço) ───────────────────────────────────────────────
import { P02BalancoService }         from './p02/p02-balanco.service';
import { P02DreService }             from './p02/p02-dre.service';
// ── P04 ───────────────────────────────────────────────────────────────────────
import { P04Service }                from './p04/p04.service';
import { AnaliseCreditoController }  from './analise-credito.controller';
import { AnaliseCreditoEcfListener } from './analise-credito-ecf.listener';

const infrastructure = [
  DuckDbService,
  EcfParquetRepository,
  ParquetCacheService,
  EcfDataSourceService,
];

@Module({
  imports:     [PrismaModule],
  controllers: [AnaliseCreditoController],
  providers:   [
    ...infrastructure,
    P01GcsService, EcfParquetWriter, P01Service,
    P02BalancoService, P02DreService,
    P04Service,
    AnaliseCreditoEcfListener,
  ],
  exports: [P01Service, P04Service],
})
export class AnaliseCreditoModule {}
