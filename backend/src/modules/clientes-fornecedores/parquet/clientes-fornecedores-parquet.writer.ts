import { Injectable, Logger } from '@nestjs/common';
import * as os   from 'node:os';
import * as path from 'node:path';
import * as fs   from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DuckDbService } from '../../analise-credito/infrastructure/duckdb/duckdb.service';
import { FatoParticipante } from '../sped/efd-icms-ipi.parser';

export interface FatoConsolidado extends FatoParticipante {
  empresaId: string;
  ano: number;
  mes: number;
  dataProcessamento: string; // ISO date: YYYY-MM-DD
}

/**
 * Converte FatoConsolidado[] em buffer Parquet (ZSTD) via DuckDB.
 *
 * Segue o mesmo padrão do EcfParquetWriter (P01):
 *   fatos[]  →  DuckDB table (Appender — bulk insert nativo)
 *            →  COPY TO /tmp/uuid.parquet (FORMAT PARQUET, CODEC ZSTD)
 *            →  Buffer lido do disco → tmp removido no finally
 */
@Injectable()
export class ClientesFornecedoresParquetWriter {
  private readonly logger = new Logger(ClientesFornecedoresParquetWriter.name);

  constructor(private readonly duckdb: DuckDbService) {}

  async escrever(fatos: FatoConsolidado[]): Promise<Buffer> {
    if (fatos.length === 0) throw new Error('Nenhum fato para escrever no Parquet');

    const conn    = await this.duckdb.connect();
    const tableId = `cf_${randomUUID().replaceAll('-', '_')}`;
    const outPath = path.join(os.tmpdir(), `selene-cf-${randomUUID()}.parquet`);

    try {
      await conn.run(`
        CREATE TABLE ${tableId} (
          empresa_id            VARCHAR NOT NULL,
          ano                   INTEGER NOT NULL,
          mes                   INTEGER NOT NULL,
          tipo_participante     VARCHAR NOT NULL,
          cod_part              VARCHAR NOT NULL,
          cnpj                  VARCHAR NOT NULL,
          cnpj_raiz             VARCHAR NOT NULL,
          razao_social          VARCHAR NOT NULL,
          valor_total           DOUBLE  NOT NULL,
          quantidade_documentos INTEGER NOT NULL,
          data_processamento    VARCHAR NOT NULL
        )
      `);

      const appender = await conn.createAppender(tableId);
      for (const f of fatos) {
        appender.appendVarchar(f.empresaId);
        appender.appendInteger(f.ano);
        appender.appendInteger(f.mes);
        appender.appendVarchar(f.tipoParticipante);
        appender.appendVarchar(f.codPart);
        appender.appendVarchar(f.cnpj);
        appender.appendVarchar(f.cnpjRaiz);
        appender.appendVarchar(f.razaoSocial);
        appender.appendDouble(f.valorTotal);
        appender.appendInteger(f.quantidadeDocumentos);
        appender.appendVarchar(f.dataProcessamento);
        appender.endRow();
      }
      appender.closeSync();

      await conn.run(
        `COPY ${tableId} TO '${toDuckPath(outPath)}' (FORMAT PARQUET, CODEC ZSTD)`,
      );

      const buffer = await fs.readFile(outPath);
      this.logger.debug(`Parquet gerado: ${fatos.length} fatos, ${buffer.length} bytes`);
      return buffer;
    } finally {
      await conn.run(`DROP TABLE IF EXISTS ${tableId}`).catch(() => {});
      conn.closeSync();
      await fs.unlink(outPath).catch(() => {});
    }
  }
}

function toDuckPath(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}
