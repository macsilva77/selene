import { Module }          from '@nestjs/common';
import { BullModule }      from '@nestjs/bull';
import { PrismaModule }    from '../../database/prisma.module';
import { AC_PIPELINE_QUEUE } from './analise-credito-queue.constants';
// ── Infraestrutura ────────────────────────────────────────────────────────────
import { DuckDbService }        from './infrastructure/duckdb/duckdb.service';
import { EcfParquetRepository } from './infrastructure/duckdb/ecf-parquet.repository';
import { ParquetCacheService }  from './infrastructure/cache/parquet-cache.service';
import { EcfDataSourceService } from './infrastructure/ecf-data-source.service';
import { P01GcsService }        from './p01/p01-gcs.service';
// ── P02 ───────────────────────────────────────────────────────────────────────
import { P02BalancoService }    from './p02/p02-balanco.service';
import { P02DreService }        from './p02/p02-dre.service';
import { P02Service }           from './p02/p02.service';
// ── P03 ───────────────────────────────────────────────────────────────────────
import { P03Service }           from './p03/p03.service';
// ── P04 ───────────────────────────────────────────────────────────────────────
import { P04Service }           from './p04/p04.service';
// ── Processor ─────────────────────────────────────────────────────────────────
import { AnaliseCreditoPipelineProcessor } from './analise-credito-pipeline.processor';

/**
 * Módulo Worker para o pipeline de análise de crédito.
 *
 * Importado exclusivamente pelo WorkerAppModule. Registra apenas o processor
 * que consome a fila AC_PIPELINE_QUEUE e executa P02→P03→P04, mais as
 * dependências mínimas necessárias.
 *
 * NÃO importa AnaliseCreditoModule — isso evita que P01Job (@Cron) seja
 * instanciado no processo worker, prevenindo disparo duplo às 02:15.
 * NÃO inclui: P01Job, AnaliseCreditoEcfListener, EcfParquetWriter,
 * AnaliseCreditoController — pertencem exclusivamente ao processo API.
 */
@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({ name: AC_PIPELINE_QUEUE }),
  ],
  providers: [
    // Infraestrutura (necessária para P02 via EcfDataSource)
    P01GcsService,
    DuckDbService,
    EcfParquetRepository,
    ParquetCacheService,
    EcfDataSourceService,
    // P02
    P02BalancoService,
    P02DreService,
    P02Service,
    // P03
    P03Service,
    // P04
    P04Service,
    // Processor
    AnaliseCreditoPipelineProcessor,
  ],
})
export class AnaliseCreditoWorkerModule {}
