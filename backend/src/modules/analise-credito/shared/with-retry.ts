import { Logger } from '@nestjs/common';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  label?:       string;
  logger?:      Logger;
  /** Retorna false para erros permanentes (ex: 403, 404) — interrompe imediatamente. */
  isRetryable?: (err: unknown) => boolean;
}

/**
 * Executa `fn` com até `maxAttempts` tentativas e backoff exponencial.
 * Erros permanentes (isRetryable=false) são lançados sem retry.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 500,
    label       = 'operação',
    logger,
    isRetryable = () => true,
  } = opts;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      handleAttemptFailure({ err, attempt, maxAttempts, baseDelayMs, label, logger, isRetryable });
      if (attempt < maxAttempts) await sleep(baseDelayMs * Math.pow(2, attempt - 1));
    }
  }

  throw new Error(`[withRetry] ${label} falhou após ${maxAttempts} tentativas: ${toMessage(lastError)}`);
}

/** Verifica se um erro GCS é permanente (não deve ser retentado). */
export function isGcsPermanentError(err: unknown): boolean {
  const code = (err as { code?: number })?.code;
  return code === 403 || code === 404;
}

// ─── Helpers privados ─────────────────────────────────────────────────────────

function handleAttemptFailure(ctx: {
  err: unknown; attempt: number; maxAttempts: number;
  baseDelayMs: number; label: string; logger?: Logger;
  isRetryable: (err: unknown) => boolean;
}): void {
  const { err, attempt, maxAttempts, baseDelayMs, label, logger, isRetryable } = ctx;
  if (!isRetryable(err)) {
    throw new Error(`[withRetry] ${label} erro permanente (sem retry): ${toMessage(err)}`);
  }
  if (attempt < maxAttempts) {
    const delay = baseDelayMs * Math.pow(2, attempt - 1);
    logger?.warn(`[withRetry] ${label} tentativa ${attempt}/${maxAttempts} (retry em ${delay}ms): ${toMessage(err)}`);
  }
}

function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try { return JSON.stringify(err) ?? '[null]'; } catch { return '[non-serializable error]'; }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
