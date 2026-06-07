/**
 * Constantes de fila Bull para o pipeline de análise de crédito (P02→P04).
 *
 * O job é enfileirado pelo P01Job após processar cada tenant/CNPJ.
 * O AnaliseCreditoPipelineProcessor (worker) consome e executa P02→P03→P04.
 *
 * Granularidade do jobId:
 *   - acPipelineJobId(tenantId)       → cron global: deduplicação por tenant
 *   - acPipelineJobIdCnpj(t, cnpj)   → disparo por CNPJ: deduplicação por (tenant, CNPJ)
 *     Evita que dois cliques rápidos no mesmo CNPJ gerem dois jobs duplicados,
 *     mas permite que CNPJ A e CNPJ B do mesmo tenant fiquem na fila ao mesmo tempo.
 */

export const AC_PIPELINE_QUEUE = 'ac:pipeline';

export interface AcPipelineJobData {
  tenantId: string;
}

/** Deduplicação por tenant — usado pelo cron global (executar). */
export const acPipelineJobId = (tenantId: string) =>
  `pipeline:${tenantId}`;

/** Deduplicação por CNPJ — usado pelo disparo por CNPJ e pelo ECF auto-trigger. */
export const acPipelineJobIdCnpj = (tenantId: string, cnpj: string) =>
  `pipeline:${tenantId}:${cnpj}`;
