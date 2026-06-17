/**
 * FaturamentoQueryService
 *
 * Responsável pelas queries de leitura de faturamento.
 * Separa responsabilidade de leitura do FaturamentoController e
 * aplica duas otimizações principais:
 *
 * 1. GROUP BY no banco (Prisma $queryRaw) — em vez de buscar todas as
 *    competências mensais e agregar em Node.js, o banco soma em uma query.
 *    Para 60 linhas (12 meses × 5 anos) a diferença é modesta; para tenants
 *    com muitas empresas/anos processados (centenas de linhas) o ganho é
 *    significativo — evita serialização e desserialização de dados desnecessários.
 *
 * 2. Cache em memória (CACHE_MANAGER) com TTL de 1 hora — dados SPED mudam
 *    apenas quando um novo arquivo é processado. O método invalidarEmpresa()
 *    limpa o cache quando mesclarCompetencias() é chamado.
 */

import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

// ─── TTL e limites ────────────────────────────────────────────────────────────

/** 1 hora em milissegundos (interface do cache-manager v5+) */
const CACHE_TTL_MS = 60 * 60 * 1_000;

// ─── Tipos retornados pelas queries raw ───────────────────────────────────────

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

export interface CfopsAnoRow extends ConsolidadoAnoRow {
  cfopsAgregados: string | null; // JSON agregado via string_agg
}

export interface CfopsBreakdown {
  vlEstaduais:      number;
  vlInterestaduais: number;
  vlExportacoes:    number;
  vlDevolucoes:     number;
  vlTransferencias: number;
  vlRemessas:       number;
}

export interface ConsolidadoAnoFull extends ConsolidadoAnoRow, CfopsBreakdown {
  vlMercadorias:    number;
  vlFatLiquido:     number;
  idxEstadual:      number;
  idxInterestadual: number;
  idxExportacao:    number;
  idxDevolucao:     number;
}

// ─── CFOPs por categoria ──────────────────────────────────────────────────────

const CFOP_DEVOLUCAO = new Set([
  '5201','5202','5210','5410','5411','5412','5413','5414','5415',
  '6201','6202','6210','6410','6411','6412','6413','6414','6415',
  '7201','7202',
]);

const CFOP_TRANSFERENCIA = new Set([
  '5151','5152','5153','5155','5156',
  '6151','6152','6153','6155','6156',
  '7151','7152',
]);

function parseCfopsJson(raw: string | null): CfopsBreakdown {
  const zero = { vlEstaduais:0, vlInterestaduais:0, vlExportacoes:0, vlDevolucoes:0, vlTransferencias:0, vlRemessas:0 };
  if (!raw) return zero;

  let entries: { cfop: string; vlOpr: number }[];
  try { entries = JSON.parse(raw) as { cfop: string; vlOpr: number }[]; }
  catch { return zero; }

  let { vlEstaduais, vlInterestaduais, vlExportacoes, vlDevolucoes, vlTransferencias, vlRemessas } = zero;

  for (const { cfop, vlOpr } of entries) {
    if (!cfop || vlOpr == null) continue;
    const v = Number(vlOpr);
    const p = cfop[0];
    if (CFOP_DEVOLUCAO.has(cfop))      vlDevolucoes    += v;
    else if (CFOP_TRANSFERENCIA.has(cfop)) vlTransferencias += v;
    else if (p === '5' && cfop >= '5900') vlRemessas     += v;
    else if (p === '6' && cfop >= '6900') vlRemessas     += v;
    else if (p === '7' && cfop >= '7900') vlRemessas     += v;
    else if (p === '5') vlEstaduais      += v;
    else if (p === '6') vlInterestaduais += v;
    else if (p === '7') vlExportacoes    += v;
  }
  return { vlEstaduais, vlInterestaduais, vlExportacoes, vlDevolucoes, vlTransferencias, vlRemessas };
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class FaturamentoQueryService {
  private readonly logger = new Logger(FaturamentoQueryService.name);

  // Mapeia { tenantId:empresaId → Set de cache-keys } para invalidação seletiva
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
    if (!this.keysByEmpresa.has(scope)) this.keysByEmpresa.set(scope, new Set());
    this.keysByEmpresa.get(scope)!.add(cacheKey);
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
          SUM(vl_faturamento_bruto)::float8    AS "vlFaturamentoBruto",
          SUM(vl_compras_bruto)::float8         AS "vlComprasBruto",
          SUM(vl_icms)::float8                  AS "vlIcms",
          SUM(vl_ipi)::float8                   AS "vlIpi",
          SUM(vl_pis)::float8                   AS "vlPis",
          SUM(vl_cofins)::float8                AS "vlCofins",
          SUM(qtd_documentos)::int              AS "qtdDocumentos",
          SUM(qtd_documentos_compras)::int      AS "qtdDocumentosCompras",
          COUNT(*)::int                         AS "mesesProcessados"
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

  // ── Consolidado com CFOP (GROUP BY + JSON agregado no banco) ─────────────

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

    // Busca valores agregados + cfopsJson concatenados por ano via string_agg.
    // A concatenação permite parsear todos os CFOPs de um ano em uma única chamada.
    const rawRows = await this.prisma.$queryRaw<CfopsAnoRow[]>(
      Prisma.sql`
        SELECT
          ano,
          SUM(vl_faturamento_bruto)::float8    AS "vlFaturamentoBruto",
          SUM(vl_compras_bruto)::float8         AS "vlComprasBruto",
          SUM(vl_icms)::float8                  AS "vlIcms",
          SUM(vl_ipi)::float8                   AS "vlIpi",
          SUM(vl_pis)::float8                   AS "vlPis",
          SUM(vl_cofins)::float8                AS "vlCofins",
          SUM(qtd_documentos)::int              AS "qtdDocumentos",
          SUM(qtd_documentos_compras)::int      AS "qtdDocumentosCompras",
          COUNT(*)::int                         AS "mesesProcessados",
          -- Concatena todos os arrays JSON de CFOPs para parsear em memória
          '[' || string_agg(
            CASE WHEN cfops_json IS NOT NULL AND cfops_json <> '' AND cfops_json <> '[]'
              THEN TRIM(BOTH '[]' FROM cfops_json)
              ELSE NULL
            END,
            ','
          ) || ']'                              AS "cfopsAgregados"
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
      const cfops = parseCfopsJson(row.cfopsAgregados);
      const fat   = row.vlFaturamentoBruto;
      const vlMercadorias = Math.max(0, fat - cfops.vlDevolucoes - cfops.vlTransferencias - cfops.vlRemessas);
      const vlFatLiquido  = Math.max(0, fat - cfops.vlDevolucoes);
      return {
        ...row,
        ...cfops,
        vlMercadorias,
        vlFatLiquido,
        idxEstadual:      fat > 0 ? cfops.vlEstaduais      / fat : 0,
        idxInterestadual: fat > 0 ? cfops.vlInterestaduais / fat : 0,
        idxExportacao:    fat > 0 ? cfops.vlExportacoes    / fat : 0,
        idxDevolucao:     fat > 0 ? cfops.vlDevolucoes     / fat : 0,
      };
    });

    await this.cache.set(ck, result, CACHE_TTL_MS);
    this.trackKey(params.tenantId, params.empresaId, ck);
    return result;
  }
}
