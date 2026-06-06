export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?:  number;
  label?:        string;
}

/**
 * Executa `fn` com até `maxAttempts` tentativas e backoff exponencial.
 * Uso: await withRetry(() => gcs.download(path), { label: 'GCS download' })
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 500, label = 'operação' } = opts;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1); // 500 → 1000 → 2000
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`[withRetry] ${label} falhou após ${maxAttempts} tentativas: ${msg}`);
}
