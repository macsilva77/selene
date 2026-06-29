/**
 * Nomes de fila BullMQ para o pipeline de distribuição do CT-e.
 *
 * Diferente da NF-e, o CT-e distribui o procCTe completo direto ao interessado —
 * não há etapa de ciência/download em dois passos. Por isso o pipeline tem apenas
 * 3 filas: distribuição (resumo), recuperação de gap e envio de evento do tomador.
 *
 * Isolamento por CNPJ: jobId = `{queue}:{tenantId}:{cnpj}` previne jobs
 * duplicados para o mesmo CNPJ na mesma fila.
 */

// ── Nomes de fila ────────────────────────────────────────────────────────────

/** Consulta distribuição (distNSU) — enfileirado pelo scheduler a cada ciclo */
export const CTE_RESUMO_QUEUE = 'cte:resumo';

/** Recuperação de gap NSU via consNSU */
export const CTE_GAP_QUEUE = 'cte:gap';

/** Envio de evento do tomador (ex: Prestação de Serviço em Desacordo 610110) */
export const CTE_EVENTO_QUEUE = 'cte:evento';

/** Varredura retroativa de NSU — iteração por configId ativo */
export const CTE_VARREDURA_QUEUE = 'cte:varredura';

// ── Payloads de job ──────────────────────────────────────────────────────────

export interface CteResumoJobData {
  tenantId: string;
  cnpj: string;
  configId: string;
  /** true = ignora cooldown proximaConsulta */
  force?: boolean;
}

export interface CteGapJobData {
  tenantId: string;
  cnpj: string;
  gapId: string;
  nsuFaltante: string;
  configId: string;
}

export interface CteEventoJobData {
  tenantId: string;
  cnpj: string;
  documentoId: string;
  chaveAcesso: string;
  /** Código do evento (ex: "610110" = Prestação de Serviço em Desacordo) */
  tpEvento: string;
}

export interface CteVarreduraJobData {
  tenantId: string;
  cnpj: string;
  configId: string;
}

// ── Helpers de jobId (deduplicação por CNPJ/recurso) ─────────────────────────

export const cteJobId = {
  resumo: (tenantId: string, cnpj: string) => `resumo:${tenantId}:${cnpj}`,
  gap: (tenantId: string, gapId: string) => `gap:${tenantId}:${gapId}`,
  evento: (tenantId: string, documentoId: string, tpEvento: string) =>
    `evento:${tenantId}:${documentoId}:${tpEvento}`,
  varredura: (tenantId: string, cnpj: string) => `varredura:${tenantId}:${cnpj}`,
};
