/**
 * Nomes de fila BullMQ para o pipeline DFe.
 *
 * Cada fila tem concurrency=1 por padrão no worker — o Redis lock já garante
 * que dois jobs do mesmo CNPJ não processem simultaneamente.
 *
 * Isolamento por CNPJ: jobId = `{queue}:{tenantId}:{cnpj}` previne jobs
 * duplicados para o mesmo CNPJ na mesma fila.
 */

// ── Nomes de fila ────────────────────────────────────────────────────────────

/** Consulta distribuição (distNSU) — enfileirado pelo scheduler a cada ciclo */
export const DFE_RESUMO_QUEUE = 'dfe:resumo';

/** Ciência automática (tpEvento=210210) por documento RES_NFE */
export const DFE_CIENCIA_QUEUE = 'dfe:ciencia';

/** Download XML completo (consChNFe) por documento RES_NFE com Ciência enviada */
export const DFE_DOWNLOAD_QUEUE = 'dfe:download';

/** Recuperação de gap NSU via consNSU */
export const DFE_GAP_QUEUE = 'dfe:gap';

/** Varredura retroativa de NSU — iteração por configId ativo */
export const DFE_VARREDURA_QUEUE = 'dfe:varredura';

// ── Payloads de job ──────────────────────────────────────────────────────────

export interface DfeResumoJobData {
  tenantId: string;
  cnpj: string;
  configId: string;
  /** true = ignora cooldown proximaConsulta */
  force?: boolean;
}

export interface DfeCienciaJobData {
  tenantId: string;
  cnpj: string;
  documentoId: string;
  chaveAcesso: string;
  configId: string;
}

export interface DfeDownloadJobData {
  tenantId: string;
  cnpj: string;
  documentoId: string;
  chaveAcesso: string;
  nsu: string;
  configId: string;
}

export interface DfeGapJobData {
  tenantId: string;
  cnpj: string;
  gapId: string;
  nsuFaltante: string;
  configId: string;
}

export interface DfeVarreduraJobData {
  tenantId: string;
  cnpj: string;
  configId: string;
}

// ── Helpers de jobId (deduplicação por CNPJ) ─────────────────────────────────

export const dfeJobId = {
  resumo: (tenantId: string, cnpj: string) => `resumo:${tenantId}:${cnpj}`,
  ciencia: (tenantId: string, documentoId: string) => `ciencia:${tenantId}:${documentoId}`,
  download: (tenantId: string, documentoId: string) => `download:${tenantId}:${documentoId}`,
  gap: (tenantId: string, gapId: string) => `gap:${tenantId}:${gapId}`,
  varredura: (tenantId: string, cnpj: string) => `varredura:${tenantId}:${cnpj}`,
};
