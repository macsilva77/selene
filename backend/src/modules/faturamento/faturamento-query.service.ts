import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/** 1 hora em milissegundos (cache-manager v5 usa ms) */
const CACHE_TTL_MS = 60 * 60 * 1_000;

// ─── Tipos de retorno ─────────────────────────────────────────────────────────

export interface ConsolidadoAnoRow {
  ano:                  number;
  vlFaturamentoBruto:   number;
  vlComprasBruto:       number;
  vlIcms:               number;
  vlIpi:                number;
  vlPis:                number;
  vlCofins:             number;
  qtdDocumentos:        number;
  qtdDocumentosCompras: number;
  mesesProcessados:     number;
}

export interface ConsolidadoAnoFull extends ConsolidadoAnoRow {
  vlEstaduais:      number;
  vlInterestaduais: number;
  vlExportacoes:    number;
  vlDevolucoes:     number;
  vlTransferencias: number;
  vlRemessas:       number;
  vlMercadorias:    number;
  vlFatLiquido:     number;
  idxEstadual:      number;
  idxInterestadual: number;
  idxExportacao:    number;
  idxDevolucao:     number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class FaturamentoQueryService {
  private readonly logger = new Logger(FaturamentoQueryService.name);

  private readonly keysByEmpresa = new Map<string, Set<string>>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  // ── Cache helpers ─────────────────────────────────────────────────────────

  private key(...parts: string[]): string {
    return `fat:${parts.join(':')}`;
  }

  private trackKey(tenantId: string, empresaId: string, cacheKey: string): void {
    const scope = `${tenantId}:${empresaId}`;
    let keys = this.keysByEmpresa.get(scope);
    if (!keys) { keys = new Set(); this.keysByEmpresa.set(scope, keys); }
    keys.add(cacheKey);
  }

  /** Invalida todo o cache de uma empresa (chamado após processamento de SPED). */
  async invalidarEmpresa(tenantId: string, empresaId: string): Promise<void> {
    const scope = `${tenantId}:${empresaId}`;
    const keys = this.keysByEmpresa.get(scope);
    if (!keys?.size) return;

    let deleted = 0;
    for (const k of keys) {
      try { await this.cache.del(k); deleted++; }
      catch { /* tolerante a falhas de cache */ }
    }
    this.keysByEmpresa.delete(scope);
    this.logger.debug(`Cache invalidado: ${deleted} chave(s) para empresa ${empresaId}`);
  }

  // ── Consolidado simples (GROUP BY no banco) ───────────────────────────────

  async consolidado(params: {
    tenantId:  string;
    empresaId: string;
    fonte:     string;
    anoInicio: number;
    anoFim:    number;
  }): Promise<ConsolidadoAnoRow[]> {
    const ck = this.key(params.tenantId, params.empresaId, 'cons', params.fonte, String(params.anoInicio), String(params.anoFim));
    const cached = await this.cache.get<ConsolidadoAnoRow[]>(ck);
    if (cached) return cached;

    const t0 = Date.now();
    const rows = await this.prisma.$queryRaw<ConsolidadoAnoRow[]>(
      Prisma.sql`
        SELECT
          ano,
          SUM(vl_faturamento_bruto)::float8   AS "vlFaturamentoBruto",
          SUM(vl_compras_bruto)::float8        AS "vlComprasBruto",
          SUM(vl_icms)::float8                 AS "vlIcms",
          SUM(vl_ipi)::float8                  AS "vlIpi",
          SUM(vl_pis)::float8                  AS "vlPis",
          SUM(vl_cofins)::float8               AS "vlCofins",
          SUM(qtd_documentos)::int             AS "qtdDocumentos",
          SUM(qtd_documentos_compras)::int     AS "qtdDocumentosCompras",
          COUNT(*)::int                        AS "mesesProcessados"
        FROM faturamento_competencias
        WHERE tenant_id  = ${params.tenantId}
          AND empresa_id = ${params.empresaId}
          AND fonte      = ${params.fonte}
          AND ano        >= ${params.anoInicio}
          AND ano        <= ${params.anoFim}
        GROUP BY ano
        ORDER BY ano ASC
      `,
    );

    this.logger.debug(`consolidado query: ${Date.now() - t0}ms (${rows.length} anos)`);
    await this.cache.set(ck, rows, CACHE_TTL_MS);
    this.trackKey(params.tenantId, params.empresaId, ck);
    return rows;
  }

  // ── Consolidado com CFOP — SUM() puro, zero JSON ──────────────────────────

  async cfopsConsolidado(params: {
    tenantId:  string;
    empresaId: string;
    fonte:     string;
    anoInicio: number;
    anoFim:    number;
  }): Promise<ConsolidadoAnoFull[]> {
    const ck = this.key(params.tenantId, params.empresaId, 'cfops', params.fonte, String(params.anoInicio), String(params.anoFim));
    const cached = await this.cache.get<ConsolidadoAnoFull[]>(ck);
    if (cached) return cached;

    const t0 = Date.now();

    // Colunas CFOP pré-categorizadas na escrita — nenhum JSON gerado ou parseado
    const rawRows = await this.prisma.$queryRaw<Omit<ConsolidadoAnoFull, 'vlMercadorias' | 'vlFatLiquido' | 'idxEstadual' | 'idxInterestadual' | 'idxExportacao' | 'idxDevolucao'>[]>(
      Prisma.sql`
        SELECT
          ano,
          SUM(vl_faturamento_bruto)::float8   AS "vlFaturamentoBruto",
          SUM(vl_compras_bruto)::float8        AS "vlComprasBruto",
          SUM(vl_icms)::float8                 AS "vlIcms",
          SUM(vl_ipi)::float8                  AS "vlIpi",
          SUM(vl_pis)::float8                  AS "vlPis",
          SUM(vl_cofins)::float8               AS "vlCofins",
          SUM(qtd_documentos)::int             AS "qtdDocumentos",
          SUM(qtd_documentos_compras)::int     AS "qtdDocumentosCompras",
          COUNT(*)::int                        AS "mesesProcessados",
          SUM(vl_estaduais)::float8            AS "vlEstaduais",
          SUM(vl_interestaduais)::float8       AS "vlInterestaduais",
          SUM(vl_exportacoes)::float8          AS "vlExportacoes",
          SUM(vl_devolucoes)::float8           AS "vlDevolucoes",
          SUM(vl_transferencias)::float8       AS "vlTransferencias",
          SUM(vl_remessas)::float8             AS "vlRemessas"
        FROM faturamento_competencias
        WHERE tenant_id  = ${params.tenantId}
          AND empresa_id = ${params.empresaId}
          AND fonte      = ${params.fonte}
          AND ano        >= ${params.anoInicio}
          AND ano        <= ${params.anoFim}
        GROUP BY ano
        ORDER BY ano ASC
      `,
    );

    this.logger.debug(`cfopsConsolidado query: ${Date.now() - t0}ms (${rawRows.length} anos)`);

    const result: ConsolidadoAnoFull[] = rawRows.map(row => {
      const fat = row.vlFaturamentoBruto;
      return {
        ...row,
        vlMercadorias:    Math.max(0, fat - row.vlDevolucoes - row.vlTransferencias - row.vlRemessas),
        vlFatLiquido:     Math.max(0, fat - row.vlDevolucoes),
        idxEstadual:      fat > 0 ? row.vlEstaduais      / fat : 0,
        idxInterestadual: fat > 0 ? row.vlInterestaduais / fat : 0,
        idxExportacao:    fat > 0 ? row.vlExportacoes    / fat : 0,
        idxDevolucao:     fat > 0 ? row.vlDevolucoes     / fat : 0,
      };
    });

    await this.cache.set(ck, result, CACHE_TTL_MS);
    this.trackKey(params.tenantId, params.empresaId, ck);
    return result;
  }
}
