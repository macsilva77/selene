import { Injectable } from '@nestjs/common';
import * as os   from 'node:os';
import * as path from 'node:path';
import * as fs   from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DuckDbService } from './duckdb.service';
import { EcfRegistroRow } from '../../p01/p01-ecf.parser';

export interface EcfConsultaOptions {
  registroEcf?:        string;
  trimestre?:          number;
  linhaCodigoPrefixo?: string;
}

/**
 * Repositório de consulta a arquivos Parquet de ECF via DuckDB.
 * Cada método recebe um Buffer (baixado do GCS), escreve em tmp e consulta.
 * O arquivo temporário é sempre removido no finally.
 */
@Injectable()
export class EcfParquetRepository {
  constructor(private readonly duckdb: DuckDbService) {}

  async consultar(buffer: Buffer, opts: EcfConsultaOptions = {}): Promise<EcfRegistroRow[]> {
    return this.withTempFile(buffer, async (fp) => {
      const where = this.buildWhere(opts);
      const sql = `
        SELECT registro_ecf, trimestre, linha_codigo, descricao, valor, status
        FROM read_parquet('${toDuckPath(fp)}')
        WHERE ${where}
        ORDER BY linha_codigo ASC
      `;
      const rows = await this.duckdb.query<RawRow>(sql);
      return rows.map(toEcfRow);
    });
  }

  async trimestresDisponiveis(buffer: Buffer, registroEcf: string): Promise<number[]> {
    return this.withTempFile(buffer, async (fp) => {
      const sql = `
        SELECT DISTINCT trimestre
        FROM read_parquet('${toDuckPath(fp)}')
        WHERE registro_ecf = '${escapeSql(registroEcf)}'
        ORDER BY trimestre ASC
      `;
      const rows = await this.duckdb.query<{ trimestre: number }>(sql);
      return rows.map(r => Number(r.trimestre));
    });
  }

  /** Executa `fn` com um arquivo .parquet temporário; limpa no finally. */
  private async withTempFile<T>(buffer: Buffer, fn: (filePath: string) => Promise<T>): Promise<T> {
    const fp = path.join(os.tmpdir(), `selene-ecf-${randomUUID()}.parquet`);
    await fs.writeFile(fp, buffer);
    try {
      return await fn(fp);
    } finally {
      await fs.unlink(fp).catch(() => {});
    }
  }

  private buildWhere(opts: EcfConsultaOptions): string {
    const clauses: string[] = ['1=1'];
    if (opts.registroEcf)
      clauses.push(`registro_ecf = '${escapeSql(opts.registroEcf)}'`);
    if (opts.trimestre !== undefined)
      clauses.push(`trimestre = ${opts.trimestre}`);
    if (opts.linhaCodigoPrefixo)
      clauses.push(`starts_with(linha_codigo, '${escapeSql(opts.linhaCodigoPrefixo)}')`);
    return clauses.join(' AND ');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface RawRow {
  registro_ecf: string;
  trimestre:    number;
  linha_codigo: string;
  descricao:    string;
  valor:        number;
  status:       string;
}

function toEcfRow(r: RawRow): EcfRegistroRow {
  return {
    registroEcf: r.registro_ecf,
    trimestre:   Number(r.trimestre),
    linhaCodigo: r.linha_codigo,
    descricao:   r.descricao,
    valor:       Number(r.valor),
    status:      r.status,
  };
}

function toDuckPath(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

function escapeSql(s: string): string {
  return s.replaceAll("'", "''");
}
