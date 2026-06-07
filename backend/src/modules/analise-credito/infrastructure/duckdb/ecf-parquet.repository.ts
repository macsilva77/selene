import { Injectable } from '@nestjs/common';
import * as os   from 'node:os';
import * as path from 'node:path';
import * as fs   from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DuckDbService, DuckDbParams } from './duckdb.service';
import { EcfRegistroRow } from '../../p01/p01-ecf.parser';

export interface EcfConsultaOptions {
  registroEcf?:        string;
  trimestre?:          number;
  linhaCodigoPrefixo?: string;
}

export interface EcfConsultaResult {
  trimestres:     number[];
  trimestreAtivo: number;
  registros:      EcfRegistroRow[];
}

/**
 * Repositório de consulta a arquivos Parquet ECF via DuckDB.
 *
 * SEGURANÇA: todas as queries usam parâmetros posicionais ($1, $2…) —
 * zero interpolação de valores controlados pelo usuário no SQL.
 * O único valor interpolado é o filePath, gerado internamente via UUID.
 */
@Injectable()
export class EcfParquetRepository {
  constructor(private readonly duckdb: DuckDbService) {}

  /**
   * Consulta otimizada: uma única escrita em /tmp, duas queries DuckDB na mesma
   * conexão. Evita o problema anterior de escrever o buffer duas vezes por candidato.
   *
   * Retorna null se não há dados para o registroEcf informado.
   */
  async consultarComTrimestres(
    buffer: Buffer,
    opts: EcfConsultaOptions & { registroEcf: string },
  ): Promise<EcfConsultaResult | null> {
    return this.withTempFile(buffer, async (fp) => {
      const p    = toDuckPath(fp);
      const conn = await this.duckdb.connect();
      try {
        const novoSchema = await this.detectarNovoSchema(conn, p);

        const trimReader = await conn.runAndReadAll(
          `SELECT DISTINCT trimestre FROM read_parquet($1)
           WHERE registro_ecf = $2 ORDER BY trimestre ASC`,
          [p, opts.registroEcf] as DuckDbParams,
        );
        const trimestres = (trimReader.getRowObjects() as { trimestre: number }[])
          .map(r => Number(r.trimestre));

        if (trimestres.length === 0) return null;

        const trimestreAtivo = opts.trimestre !== undefined && trimestres.includes(opts.trimestre)
          ? opts.trimestre
          : Math.max(...trimestres);

        const hasPrefixo = Boolean(opts.linhaCodigoPrefixo);
        const sql    = buildSelectSql(hasPrefixo ? 4 : 3, opts, novoSchema);
        const params = hasPrefixo
          ? [p, opts.registroEcf, trimestreAtivo, opts.linhaCodigoPrefixo]
          : [p, opts.registroEcf, trimestreAtivo];

        const regReader = await conn.runAndReadAll(sql, params as DuckDbParams);
        const registros = (regReader.getRowObjects() as unknown as RawRow[]).map(toEcfRow);

        return { trimestres, trimestreAtivo, registros };
      } finally {
        conn.closeSync();
      }
    });
  }

  /** Consulta genérica — para uso em P02 que não precisa de trimestres. */
  async consultar(buffer: Buffer, opts: EcfConsultaOptions = {}): Promise<EcfRegistroRow[]> {
    return this.withTempFile(buffer, async (fp) => {
      const p         = toDuckPath(fp);
      const conn      = await this.duckdb.connect();
      try {
        const novoSchema = await this.detectarNovoSchema(conn, p);
        const params     = buildParams(p, opts);
        const sql        = buildSelectSql(params.count, opts, novoSchema);
        const reader     = await conn.runAndReadAll(sql, params.values);
        return (reader.getRowObjects() as unknown as RawRow[]).map(toEcfRow);
      } finally {
        conn.closeSync();
      }
    });
  }

  /**
   * Verifica se o Parquet foi gerado com o novo schema (contém ind_cta).
   * Parquets antigos (pré-v5) não têm as colunas de movimentação.
   */
  private async detectarNovoSchema(conn: import('@duckdb/node-api').DuckDBConnection, filePath: string): Promise<boolean> {
    const result = await conn.runAndReadAll(
      `SELECT COUNT(*) > 0 AS tem FROM parquet_schema('${filePath}') WHERE name = 'ind_cta'`,
    );
    const rows = result.getRowObjects() as { tem: boolean }[];
    return rows[0]?.tem === true;
  }

  async trimestresDisponiveis(buffer: Buffer, registroEcf: string): Promise<number[]> {
    return this.withTempFile(buffer, async (fp) => {
      const rows = await this.duckdb.query<{ trimestre: number }>(
        `SELECT DISTINCT trimestre FROM read_parquet($1)
         WHERE registro_ecf = $2 ORDER BY trimestre ASC`,
        [toDuckPath(fp), registroEcf] as DuckDbParams,
      );
      return rows.map(r => Number(r.trimestre));
    });
  }

  private async withTempFile<T>(buffer: Buffer, fn: (filePath: string) => Promise<T>): Promise<T> {
    const fp = path.join(os.tmpdir(), `selene-ecf-${randomUUID()}.parquet`);
    await fs.writeFile(fp, buffer);
    try {
      return await fn(fp);
    } finally {
      await fs.unlink(fp).catch(() => {});
    }
  }
}

// ─── Tipos e helpers internos ─────────────────────────────────────────────────

interface RawRow {
  registro_ecf:       string;
  trimestre:          number;
  linha_codigo:       string;
  descricao:          string;
  ind_cta:            string | null;
  nivel:              number | null;
  saldo_anterior:     number;
  natureza_anterior:  string;
  total_debitos:      number | null;
  total_creditos:     number | null;
  valor:              number;
  natureza_final:     string;
  status:             string;
}

function toEcfRow(r: RawRow): EcfRegistroRow {
  return {
    registroEcf:      r.registro_ecf,
    trimestre:        Number(r.trimestre),
    linhaCodigo:      r.linha_codigo,
    descricao:        r.descricao,
    indCta:           (r.ind_cta === 'S' || r.ind_cta === 'A') ? r.ind_cta : null,
    nivel:            r.nivel === null ? null : Number(r.nivel),
    saldoAnterior:    Number(r.saldo_anterior ?? 0),
    naturezaAnterior: r.natureza_anterior ?? 'D',
    totalDebitos:     r.total_debitos === null ? null : Number(r.total_debitos),
    totalCreditos:    r.total_creditos === null ? null : Number(r.total_creditos),
    valor:            Number(r.valor),
    naturezaFinal:    r.natureza_final ?? 'D',
    status:           r.status,
  };
}

function toDuckPath(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

function buildParams(filePath: string, opts: EcfConsultaOptions): { count: number; values: DuckDbParams } {
  const values: (string | number)[] = [filePath];
  if (opts.registroEcf)             values.push(opts.registroEcf);
  if (opts.trimestre !== undefined)  values.push(opts.trimestre);
  if (opts.linhaCodigoPrefixo)      values.push(opts.linhaCodigoPrefixo);
  return { count: values.length, values };
}

function buildSelectSql(paramCount: number, opts: EcfConsultaOptions, novoSchema = true): string {
  const clauses: string[] = [];
  let i = 2; // $1 = filePath
  if (opts.registroEcf)             clauses.push(`registro_ecf = $${i++}`);
  if (opts.trimestre !== undefined)  clauses.push(`trimestre = $${i++}`);
  if (opts.linhaCodigoPrefixo)      clauses.push(`starts_with(linha_codigo, $${i++})`);

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  // Parquets antigos (pré-migração) não têm as colunas de movimentação.
  // Usamos NULLs e constantes para manter o contrato de EcfRegistroRow.
  const movCols = novoSchema
    ? `ind_cta, nivel, saldo_anterior, natureza_anterior, total_debitos, total_creditos, valor, natureza_final`
    : `NULL AS ind_cta, NULL AS nivel, 0.0 AS saldo_anterior, 'D' AS natureza_anterior, NULL AS total_debitos, NULL AS total_creditos, valor, 'D' AS natureza_final`;

  return `SELECT registro_ecf, trimestre, linha_codigo, descricao,
                 ${movCols}, status
          FROM read_parquet($1) ${where} ORDER BY linha_codigo ASC`;
}
