import { Injectable } from '@nestjs/common';
import * as os   from 'node:os';
import * as path from 'node:path';
import * as fs   from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { DuckDbService, DuckDbParams } from '../../analise-credito/infrastructure/duckdb/duckdb.service';
import { ClientesFornecedoresGcsService } from '../gcs/clientes-fornecedores-gcs.service';

// ─── Tipos de retorno ─────────────────────────────────────────────────────────

export interface RankingParticipanteRow {
  ranking: number;
  cnpj: string;
  cnpjRaiz: string;
  razaoSocial: string;
  valorTotal: number;
  percentual: number;
  acumulado: number;
  quantidadeDocumentos: number;
  classeAbc: 'A' | 'B' | 'C';
}

export interface RaizRankingRow {
  ranking: number;
  cnpjRaiz: string;
  razaoSocial: string;
  valorTotal: number;
  percentual: number;
  acumulado: number;
  quantidadeDocumentos: number;
  qtdCnpjs: number;
  classeAbc: 'A' | 'B' | 'C';
}

export interface DrillDownRow {
  cnpj: string;
  cnpjRaiz: string;
  razaoSocial: string;
  valorTotal: number;
  percentualGrupo: number;
  quantidadeDocumentos: number;
  isMatriz: boolean;
}

// ─── Repositório ──────────────────────────────────────────────────────────────

/**
 * Consultas analíticas sobre Parquets de clientes/fornecedores via DuckDB.
 *
 * SEGURANÇA:
 *   - Caminhos de arquivo no read_parquet() são UUIDs gerados internamente — nunca entrada do usuário.
 *   - Valores do usuário (empresaId, tipo, cnpj, cnpjRaiz) usam parâmetros posicionais $1, $2…
 *   - topN é validado como inteiro positivo antes de ser interpolado no LIMIT.
 */
@Injectable()
export class ClientesFornecedoresParquetRepository {
  constructor(
    private readonly duckdb: DuckDbService,
    private readonly gcs: ClientesFornecedoresGcsService,
  ) {}

  // ─── Top N / ranking completo ─────────────────────────────────────────────

  async consultarRanking(
    gcsUris: string[],
    empresaId: string,
    cnpjEmpresa: string,
    tipo: string,
    topN?: number,
  ): Promise<RankingParticipanteRow[]> {
    if (gcsUris.length === 0) return [];
    return this.withTmpFiles(gcsUris, async (tmpFiles) => {
      const fileList   = toFileList(tmpFiles);
      const limitClause = topN != null ? `LIMIT ${Math.trunc(Math.abs(topN))}` : '';
      const sql = buildRankingSql(fileList, limitClause);
      return this.runRanking(sql, [empresaId, tipo, cnpjEmpresa] as DuckDbParams);
    });
  }

  // ─── Por CNPJ (ranking global filtrado) ──────────────────────────────────

  async consultarPorCnpj(
    gcsUris: string[],
    empresaId: string,
    cnpjEmpresa: string,
    tipo: string,
    cnpj: string,
  ): Promise<RankingParticipanteRow[]> {
    if (gcsUris.length === 0) return [];
    return this.withTmpFiles(gcsUris, async (tmpFiles) => {
      const fileList = toFileList(tmpFiles);
      const sql = buildRankingSql(fileList, '', `WHERE cnpj LIKE '%' || $4 || '%'`);
      return this.runRanking(sql, [empresaId, tipo, cnpjEmpresa, cnpj] as DuckDbParams);
    });
  }

  // ─── Por raiz de CNPJ (grupo econômico) ──────────────────────────────────

  async consultarPorRaiz(
    gcsUris: string[],
    empresaId: string,
    cnpjEmpresa: string,
    tipo: string,
  ): Promise<RaizRankingRow[]> {
    if (gcsUris.length === 0) return [];
    return this.withTmpFiles(gcsUris, async (tmpFiles) => {
      const fileList = toFileList(tmpFiles);
      const sql = `
        WITH base AS (
          SELECT cnpj, cnpj_raiz,
                 MAX(razao_social)          AS razao_social,
                 SUM(valor_total)           AS valor_cnpj,
                 SUM(quantidade_documentos) AS qtd_docs_cnpj
          FROM read_parquet([${fileList}])
          WHERE empresa_id = $1 AND tipo_participante = $2
                AND cnpj != $3 AND cnpj != '00000000000000'
          GROUP BY cnpj, cnpj_raiz
        ),
        raiz_agg AS (
          SELECT cnpj_raiz,
                 SUM(valor_cnpj)      AS valor_total,
                 SUM(qtd_docs_cnpj)   AS quantidade_documentos,
                 COUNT(DISTINCT cnpj) AS qtd_cnpjs
          FROM base
          GROUP BY cnpj_raiz
        ),
        razao_priority AS (
          SELECT DISTINCT ON (cnpj_raiz)
            cnpj_raiz, razao_social
          FROM base
          ORDER BY cnpj_raiz,
                   CASE WHEN SUBSTRING(cnpj, 9, 4) = '0001' THEN 0 ELSE 1 END ASC,
                   valor_cnpj DESC
        ),
        total AS (SELECT SUM(valor_total) AS soma FROM raiz_agg),
        ranked AS (
          SELECT r.cnpj_raiz, rp.razao_social,
                 r.valor_total, r.quantidade_documentos, r.qtd_cnpjs,
                 r.valor_total * 100.0 / NULLIF(t.soma, 0) AS percentual,
                 SUM(r.valor_total) OVER (ORDER BY r.valor_total DESC
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
                   * 100.0 / NULLIF(t.soma, 0)             AS acumulado,
                 ROW_NUMBER() OVER (ORDER BY r.valor_total DESC) AS ranking
          FROM raiz_agg r
          JOIN razao_priority rp ON r.cnpj_raiz = rp.cnpj_raiz
          CROSS JOIN total t
        )
        SELECT ranking, cnpj_raiz, razao_social, valor_total,
               ROUND(percentual, 4)    AS percentual,
               ROUND(acumulado,  4)    AS acumulado,
               quantidade_documentos, qtd_cnpjs,
               CASE WHEN (acumulado - percentual) < 80 THEN 'A'
                    WHEN (acumulado - percentual) < 95 THEN 'B'
                    ELSE 'C' END       AS classe_abc
        FROM ranked
        ORDER BY ranking
      `;
      const conn = await this.duckdb.connect();
      try {
        const reader = await conn.runAndReadAll(sql, [empresaId, tipo, cnpjEmpresa] as DuckDbParams);
        return (reader.getRowObjects() as unknown as RawRaizRow[]).map(toRaizRow);
      } finally {
        conn.closeSync();
      }
    });
  }

  // ─── Drill-down: CNPJs individuais de um grupo econômico ─────────────────

  async consultarDrillDown(
    gcsUris: string[],
    empresaId: string,
    cnpjEmpresa: string,
    tipo: string,
    cnpjRaiz: string,
  ): Promise<DrillDownRow[]> {
    if (gcsUris.length === 0) return [];
    return this.withTmpFiles(gcsUris, async (tmpFiles) => {
      const fileList = toFileList(tmpFiles);
      const sql = `
        WITH base AS (
          SELECT cnpj, cnpj_raiz,
                 MAX(razao_social)          AS razao_social,
                 SUM(valor_total)           AS valor_total,
                 SUM(quantidade_documentos) AS quantidade_documentos
          FROM read_parquet([${fileList}])
          WHERE empresa_id = $1 AND tipo_participante = $2
                AND cnpj_raiz = $3 AND cnpj != $4 AND cnpj != '00000000000000'
          GROUP BY cnpj, cnpj_raiz
        ),
        total AS (SELECT SUM(valor_total) AS soma FROM base)
        SELECT b.cnpj, b.cnpj_raiz, b.razao_social,
               b.valor_total,
               ROUND(b.valor_total * 100.0 / NULLIF(t.soma, 0), 4) AS percentual_grupo,
               b.quantidade_documentos,
               (SUBSTRING(b.cnpj, 9, 4) = '0001') AS is_matriz
        FROM base b, total t
        ORDER BY b.valor_total DESC
      `;
      const conn = await this.duckdb.connect();
      try {
        const reader = await conn.runAndReadAll(sql, [empresaId, tipo, cnpjRaiz, cnpjEmpresa] as DuckDbParams);
        return (reader.getRowObjects() as unknown as RawDrillDownRow[]).map(toDrillDownRow);
      } finally {
        conn.closeSync();
      }
    });
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────

  private async withTmpFiles<T>(
    gcsUris: string[],
    fn: (tmpFiles: string[]) => Promise<T>,
  ): Promise<T> {
    const tmpFiles: string[] = [];
    try {
      const buffers = await Promise.all(gcsUris.map((uri) => this.gcs.downloadFromUri(uri)));
      for (const buf of buffers) {
        const fp = path.join(os.tmpdir(), `selene-cf-qry-${randomUUID()}.parquet`);
        await fs.writeFile(fp, buf);
        tmpFiles.push(fp);
      }
      return await fn(tmpFiles);
    } finally {
      await Promise.all(tmpFiles.map((fp) => fs.unlink(fp).catch(() => {})));
    }
  }

  private async runRanking(sql: string, params: DuckDbParams): Promise<RankingParticipanteRow[]> {
    const conn = await this.duckdb.connect();
    try {
      const reader = await conn.runAndReadAll(sql, params);
      return (reader.getRowObjects() as unknown as RawRankingRow[]).map(toRankingRow);
    } finally {
      conn.closeSync();
    }
  }
}

// ─── Funções puras ────────────────────────────────────────────────────────────

function toDuckPath(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

function toFileList(tmpFiles: string[]): string {
  return tmpFiles.map((f) => `'${toDuckPath(f)}'`).join(', ');
}

/**
 * Monta o SELECT de ranking com ABC dinâmico.
 *   fileList    — lista segura de caminhos de arquivo (UUIDs internos, não interpolados do usuário)
 *   limitClause — ex: 'LIMIT 20' ou '' para todos
 *   filterClause — ex: "WHERE cnpj LIKE '%' || $3 || '%'" para busca por CNPJ
 */
function buildRankingSql(fileList: string, limitClause: string, filterClause = ''): string {
  return `
    WITH base AS (
      SELECT cnpj, cnpj_raiz,
             MAX(razao_social)          AS razao_social,
             SUM(valor_total)           AS valor_total,
             SUM(quantidade_documentos) AS quantidade_documentos
      FROM read_parquet([${fileList}])
      WHERE empresa_id = $1 AND tipo_participante = $2
            AND cnpj != $3 AND cnpj != '00000000000000'
      GROUP BY cnpj, cnpj_raiz
    ),
    total AS (SELECT SUM(valor_total) AS soma FROM base),
    ranked AS (
      SELECT b.cnpj, b.cnpj_raiz, b.razao_social,
             b.valor_total, b.quantidade_documentos,
             b.valor_total * 100.0 / NULLIF(t.soma, 0) AS percentual,
             SUM(b.valor_total) OVER (ORDER BY b.valor_total DESC
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
               * 100.0 / NULLIF(t.soma, 0)             AS acumulado,
             ROW_NUMBER() OVER (ORDER BY b.valor_total DESC) AS ranking
      FROM base b, total t
    )
    SELECT ranking, cnpj, cnpj_raiz, razao_social, valor_total,
           ROUND(percentual, 4) AS percentual,
           ROUND(acumulado,  4) AS acumulado,
           quantidade_documentos,
           CASE WHEN (acumulado - percentual) < 80 THEN 'A'
                WHEN (acumulado - percentual) < 95 THEN 'B'
                ELSE 'C' END    AS classe_abc
    FROM ranked
    ${filterClause}
    ORDER BY ranking
    ${limitClause}
  `;
}

// ─── Mapeadores raw → typed ────────────────────────────────────────────────────

interface RawRankingRow {
  ranking:               number | bigint;
  cnpj:                  string;
  cnpj_raiz:             string;
  razao_social:          string;
  valor_total:           number;
  percentual:            number;
  acumulado:             number;
  quantidade_documentos: number | bigint;
  classe_abc:            string;
}

interface RawRaizRow {
  ranking:               number | bigint;
  cnpj_raiz:             string;
  razao_social:          string;
  valor_total:           number;
  percentual:            number;
  acumulado:             number;
  quantidade_documentos: number | bigint;
  qtd_cnpjs:             number | bigint;
  classe_abc:            string;
}

interface RawDrillDownRow {
  cnpj:                  string;
  cnpj_raiz:             string;
  razao_social:          string;
  valor_total:           number;
  percentual_grupo:      number;
  quantidade_documentos: number | bigint;
  is_matriz:             boolean;
}

function toRankingRow(r: RawRankingRow): RankingParticipanteRow {
  return {
    ranking:              Number(r.ranking),
    cnpj:                 r.cnpj,
    cnpjRaiz:             r.cnpj_raiz,
    razaoSocial:          r.razao_social,
    valorTotal:           Number(r.valor_total),
    percentual:           Number(r.percentual),
    acumulado:            Number(r.acumulado),
    quantidadeDocumentos: Number(r.quantidade_documentos),
    classeAbc:            (r.classe_abc as 'A' | 'B' | 'C') || 'C',
  };
}

function toRaizRow(r: RawRaizRow): RaizRankingRow {
  return {
    ranking:              Number(r.ranking),
    cnpjRaiz:             r.cnpj_raiz,
    razaoSocial:          r.razao_social,
    valorTotal:           Number(r.valor_total),
    percentual:           Number(r.percentual),
    acumulado:            Number(r.acumulado),
    quantidadeDocumentos: Number(r.quantidade_documentos),
    qtdCnpjs:             Number(r.qtd_cnpjs),
    classeAbc:            (r.classe_abc as 'A' | 'B' | 'C') || 'C',
  };
}

function toDrillDownRow(r: RawDrillDownRow): DrillDownRow {
  return {
    cnpj:                 r.cnpj,
    cnpjRaiz:             r.cnpj_raiz,
    razaoSocial:          r.razao_social,
    valorTotal:           Number(r.valor_total),
    percentualGrupo:      Number(r.percentual_grupo),
    quantidadeDocumentos: Number(r.quantidade_documentos),
    isMatriz:             Boolean(r.is_matriz),
  };
}
