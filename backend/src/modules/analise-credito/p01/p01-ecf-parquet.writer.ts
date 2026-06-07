import { Injectable, Logger } from '@nestjs/common';
import * as os   from 'node:os';
import * as path from 'node:path';
import * as fs   from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DuckDbService } from '../infrastructure/duckdb/duckdb.service';
import { EcfRegistroRow } from './p01-ecf.parser';

/**
 * Converte EcfRegistroRow[] em buffer Parquet (ZSTD) via DuckDB.
 *
 * Fluxo:
 *   rows[]  →  DuckDB table (Appender — bulk insert nativo, sem round-trips SQL)
 *           →  COPY TO /tmp/uuid.parquet (FORMAT PARQUET, CODEC ZSTD)
 *           →  Buffer lido do disco → tmp removido no finally
 */
@Injectable()
export class EcfParquetWriter {
  private readonly logger = new Logger(EcfParquetWriter.name);

  constructor(private readonly duckdb: DuckDbService) {}

  async escrever(rows: EcfRegistroRow[]): Promise<Buffer> {
    if (rows.length === 0) throw new Error('Nenhum registro ECF para escrever no Parquet');

    const conn    = await this.duckdb.connect();
    // Nome único para evitar colisão em execuções paralelas
    const tableId = `ecf_${randomUUID().replaceAll('-', '_')}`;
    const outPath = path.join(os.tmpdir(), `selene-ecf-${randomUUID()}.parquet`);

    try {
      // 1. Cria tabela temporária na instância in-memory
      await conn.run(`
        CREATE TABLE ${tableId} (
          registro_ecf       VARCHAR  NOT NULL,
          trimestre          INTEGER  NOT NULL,
          linha_codigo       VARCHAR  NOT NULL,
          descricao          VARCHAR  NOT NULL,
          ind_cta            VARCHAR,
          nivel              INTEGER,
          saldo_anterior     DOUBLE   NOT NULL DEFAULT 0,
          natureza_anterior  VARCHAR  NOT NULL DEFAULT 'D',
          total_debitos      DOUBLE,
          total_creditos     DOUBLE,
          valor              DOUBLE   NOT NULL,
          natureza_final     VARCHAR  NOT NULL DEFAULT 'D',
          status             VARCHAR  NOT NULL
        )
      `);

      const appender = await conn.createAppender(tableId);
      for (const row of rows) {
        appender.appendVarchar(row.registroEcf);
        appender.appendInteger(row.trimestre);
        appender.appendVarchar(row.linhaCodigo);
        appender.appendVarchar(row.descricao);
        row.indCta ? appender.appendVarchar(row.indCta) : appender.appendNull();
        row.nivel  ? appender.appendInteger(row.nivel)  : appender.appendNull();
        appender.appendDouble(row.saldoAnterior);
        appender.appendVarchar(row.naturezaAnterior);
        row.totalDebitos  !== null ? appender.appendDouble(row.totalDebitos)  : appender.appendNull();
        row.totalCreditos !== null ? appender.appendDouble(row.totalCreditos) : appender.appendNull();
        appender.appendDouble(row.valor);
        appender.appendVarchar(row.naturezaFinal);
        appender.appendVarchar(row.status);
        appender.endRow();
      }
      appender.closeSync(); // flush síncrono + close

      // 3. Exporta para Parquet comprimido (ZSTD — melhor ratio para dados textuais)
      await conn.run(
        `COPY ${tableId} TO '${toDuckPath(outPath)}' (FORMAT PARQUET, CODEC ZSTD)`,
      );

      const buffer = await fs.readFile(outPath);
      this.logger.debug(`Parquet gerado: ${rows.length} registros, ${buffer.length} bytes`);
      return buffer;
    } finally {
      // DROP TABLE no finally garante limpeza mesmo em caso de exceção entre COPY e return
      await conn.run(`DROP TABLE IF EXISTS ${tableId}`).catch(() => {});
      conn.closeSync();
      await fs.unlink(outPath).catch(() => {});
    }
  }
}

function toDuckPath(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}
