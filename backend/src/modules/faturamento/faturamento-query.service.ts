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

/** Faturamento dos últimos 12 meses disponíveis (LTM) + carga tributária efetiva. */
export interface FaturamentoLtm {
  meses:               number;       // quantos meses entraram (≤ 12)
  periodoInicio:       string | null; // 'AAAA-MM'
  periodoFim:          string | null;
  vlFaturamentoBruto:  number;
  vlImpostos:          number;       // ICMS + IPI + PIS + COFINS
  cargaTributaria:     number | null; // impostos / bruto (null se bruto = 0)
  vlVendasMercadoria:  number;       // bruto − devoluções − transferências − remessas
  vlFatLiquido:        number;       // bruto − impostos − devoluções
}

export interface LtmRow {
  ano: number; mes: number; bruto: number; icms: number; ipi: number;
  pis: number; cofins: number; dev: number; transf: number; rem: number;
}

/** Agregação pura do LTM (últimos 12 meses já selecionados). Testável sem I/O. */
export function agregarLtm(rows: LtmRow[]): FaturamentoLtm {
  const bruto    = rows.reduce((s, r) => s + r.bruto, 0);
  const impostos = rows.reduce((s, r) => s + r.icms + r.ipi + r.pis + r.cofins, 0);
  const dev      = rows.reduce((s, r) => s + r.dev, 0);
  const transf   = rows.reduce((s, r) => s + r.transf, 0);
  const rem      = rows.reduce((s, r) => s + r.rem, 0);
  const comp = (r: { ano: number; mes: number }) => `${r.ano}-${String(r.mes).padStart(2, '0')}`;
  const ord  = [...rows].sort((a, b) => (a.ano * 12 + a.mes) - (b.ano * 12 + b.mes));
  return {
    meses:              rows.length,
    periodoInicio:      ord.length ? comp(ord[0]) : null,
    periodoFim:         ord.length ? comp(ord[ord.length - 1]) : null,
    vlFaturamentoBruto: bruto,
    vlImpostos:         impostos,
    cargaTributaria:    bruto > 0 ? impostos / bruto : null,
    vlVendasMercadoria: Math.max(0, bruto - dev - transf - rem),
    vlFatLiquido:       Math.max(0, bruto - impostos - dev),
  };
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

  /** Remove entradas de cache da empresa (chamado após processamento de SPED). */
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

  // ── LTM (últimos 12 meses) + carga tributária ─────────────────────────────
  async ltm(params: { tenantId: string; empresaId: string; fonte?: string }): Promise<FaturamentoLtm> {
    const fonte = params.fonte ?? 'EFD_ICMS';
    const ck = this.key(params.tenantId, params.empresaId, 'ltm', fonte);
    const cached = await this.cache.get<FaturamentoLtm>(ck);
    if (cached) return cached;

    // LTM = janela dos 12 meses anteriores à última competência (contígua).
    // Evita "esticar" o período quando há furos de competência: meses < 12 nesse
    // caso reflete honestamente a cobertura, em vez de pegar 12 linhas espalhadas.
    const rows = await this.prisma.$queryRaw<{ ano: number; mes: number; bruto: number; icms: number; ipi: number; pis: number; cofins: number; dev: number; transf: number; rem: number }[]>(
      Prisma.sql`
        SELECT ano, mes,
          vl_faturamento_bruto::float8 AS bruto, vl_icms::float8 AS icms, vl_ipi::float8 AS ipi,
          vl_pis::float8 AS pis, vl_cofins::float8 AS cofins, vl_devolucoes::float8 AS dev,
          vl_transferencias::float8 AS transf, vl_remessas::float8 AS rem
        FROM faturamento_competencias
        WHERE tenant_id = ${params.tenantId} AND empresa_id = ${params.empresaId} AND fonte = ${fonte}
          AND (ano * 12 + mes) > (
            SELECT MAX(ano * 12 + mes) - 12 FROM faturamento_competencias
            WHERE tenant_id = ${params.tenantId} AND empresa_id = ${params.empresaId} AND fonte = ${fonte}
          )
        ORDER BY ano DESC, mes DESC
      `,
    );

    const result = agregarLtm(rows);
    await this.cache.set(ck, result, CACHE_TTL_MS);
    this.trackKey(params.tenantId, params.empresaId, ck);
    return result;
  }
}
