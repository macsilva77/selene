import { Injectable } from '@nestjs/common';
import * as os   from 'node:os';
import * as path from 'node:path';
import * as fs   from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { DuckDBConnection } from '@duckdb/node-api';
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
  origemDados?:   'ecf_fresco' | 'db_legado'; // Parquet GCS vs banco relacional legado — setado pelo EcfDataSourceService
}

/**
 * Repositório de consulta a arquivos Parquet ECF via DuckDB.
 *
 * SEGURANÇA:
 *   - file path no read_parquet() usa interpolação segura (gerado internamente via UUID)
 *   - valores do usuário (registroEcf, trimestre, prefixo) usam parâmetros posicionais $1, $2…
 *   - DuckDB não suporta $1 como argumento de table functions — só em cláusulas WHERE/SELECT
 */
@Injectable()
export class EcfParquetRepository {
  constructor(private readonly duckdb: DuckDbService) {}

  /**
   * Consulta otimizada: buffer escrito em /tmp uma vez, duas queries na mesma conexão.
   * Retorna null se não há dados para o registroEcf informado.
   * Aceita `novoSchema` pré-calculado (do cache) para evitar a query parquet_schema().
   */
  async consultarComTrimestres(
    buffer: Buffer,
    opts: EcfConsultaOptions & { registroEcf: string; cachedNovoSchema?: boolean | null },
  ): Promise<EcfConsultaResult & { novoSchema: boolean } | null> {
    return this.withTempFile(buffer, async (fp) => {
      const p    = toDuckPath(fp);
      const conn = await this.duckdb.connect();
      try {
        const novoSchema = opts.cachedNovoSchema ?? await this.detectarNovoSchema(conn, p);

        // $1 = registroEcf (file path é interpolado diretamente no read_parquet)
        const trimReader = await conn.runAndReadAll(
          `SELECT DISTINCT trimestre FROM read_parquet('${p}')
           WHERE registro_ecf = $1 ORDER BY trimestre ASC`,
          [opts.registroEcf] as DuckDbParams,
        );
        const trimestres = (trimReader.getRowObjects() as { trimestre: number }[])
          .map(r => Number(r.trimestre));

        if (trimestres.length === 0) return null;

        const trimestreAtivo = opts.trimestre !== undefined && trimestres.includes(opts.trimestre)
          ? opts.trimestre
          : Math.max(...trimestres);

        const { sql, params } = buildSelectQuery(p, opts.registroEcf, trimestreAtivo, novoSchema, opts.linhaCodigoPrefixo);
        const regReader = await conn.runAndReadAll(sql, params);
        const registros = (regReader.getRowObjects() as unknown as RawRow[]).map(toEcfRow);

        return { trimestres, trimestreAtivo, registros, novoSchema };
      } finally {
        conn.closeSync();
      }
    });
  }

  /** Consulta genérica — para uso em P02. */
  async consultar(buffer: Buffer, opts: EcfConsultaOptions = {}): Promise<EcfRegistroRow[]> {
    return this.withTempFile(buffer, async (fp) => {
      const p    = toDuckPath(fp);
      const conn = await this.duckdb.connect();
      try {
        const novoSchema = await this.detectarNovoSchema(conn, p);
        const { sql, params } = buildSelectQuery(
          p,
          opts.registroEcf,
          opts.trimestre,
          novoSchema,
          opts.linhaCodigoPrefixo,
        );
        const reader = await conn.runAndReadAll(sql, params);
        return (reader.getRowObjects() as unknown as RawRow[]).map(toEcfRow);
      } finally {
        conn.closeSync();
      }
    });
  }

  async trimestresDisponiveis(buffer: Buffer, registroEcf: string): Promise<number[]> {
    return this.withTempFile(buffer, async (fp) => {
      const p    = toDuckPath(fp);
      const conn = await this.duckdb.connect();
      try {
        const reader = await conn.runAndReadAll(
          `SELECT DISTINCT trimestre FROM read_parquet('${p}')
           WHERE registro_ecf = $1 ORDER BY trimestre ASC`,
          [registroEcf] as DuckDbParams,
        );
        return (reader.getRowObjects() as { trimestre: number }[]).map(r => Number(r.trimestre));
      } finally {
        conn.closeSync();
      }
    });
  }

  /** Lista os tipos de registro presentes no Parquet (ex.: L300, P150, U100…). */
  async registrosDisponiveis(buffer: Buffer): Promise<string[]> {
    return this.withTempFile(buffer, async (fp) => {
      const p    = toDuckPath(fp);
      const conn = await this.duckdb.connect();
      try {
        const reader = await conn.runAndReadAll(
          `SELECT DISTINCT registro_ecf FROM read_parquet('${p}') ORDER BY registro_ecf`,
        );
        return (reader.getRowObjects() as { registro_ecf: string }[]).map(r => r.registro_ecf);
      } finally {
        conn.closeSync();
      }
    });
  }

  /**
   * Detecta se o Parquet tem o novo schema (pós-migração com colunas de movimentação).
   * Parquets antigos não têm ind_cta — usamos NULLs para compatibilidade retroativa.
   */
  private async detectarNovoSchema(conn: DuckDBConnection, filePath: string): Promise<boolean> {
    const result = await conn.runAndReadAll(
      `SELECT COUNT(*) AS cnt FROM parquet_schema('${filePath}') WHERE name = 'ind_cta'`,
    );
    const rows = result.getRowObjects() as { cnt: number | bigint }[];
    const cnt  = rows[0]?.cnt ?? 0;
    return Number(cnt) > 0;
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

// ─── Tipos internos ───────────────────────────────────────────────────────────

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

/**
 * Constrói SELECT + WHERE com parâmetros posicionais para valores do usuário.
 * O file path já está embutido no read_parquet() — não entra nos params.
 *
 * NOTA: read_parquet() não aceita $1 como argumento, apenas valores literais.
 */
function buildSelectQuery(
  filePath:    string,
  registroEcf: string | undefined,
  trimestre:   number | undefined,
  novoSchema:  boolean,
  prefixo?:    string,
): { sql: string; params: DuckDbParams } {
  const clauses: string[] = [];
  const values: (string | number)[] = [];
  if (registroEcf)       { clauses.push(`registro_ecf = $${values.push(registroEcf)}`); }
  if (trimestre !== undefined) { clauses.push(`trimestre = $${values.push(trimestre)}`); }
  if (prefixo)           { clauses.push(`starts_with(linha_codigo, $${values.push(prefixo)})`); }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const movCols = novoSchema
    ? `ind_cta, nivel, saldo_anterior, natureza_anterior, total_debitos, total_creditos, valor, natureza_final`
    : `NULL AS ind_cta, NULL AS nivel, 0.0 AS saldo_anterior, 'D' AS natureza_anterior, NULL AS total_debitos, NULL AS total_creditos, valor, 'D' AS natureza_final`;

  const sql = `SELECT registro_ecf, trimestre, linha_codigo, descricao,
                      ${movCols}, status
               FROM read_parquet('${filePath}') ${where} ORDER BY linha_codigo ASC`;

  return { sql, params: values };
}
