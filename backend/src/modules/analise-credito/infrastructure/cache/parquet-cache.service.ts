import { Injectable } from '@nestjs/common';

interface CacheEntry {
  buffer:     Buffer;
  novoSchema: boolean | null; // null = ainda não detectado
  expiresAt:  number;
}

/**
 * Cache LRU in-memory para buffers Parquet.
 * Evita downloads repetidos do GCS para a mesma empresa/exercício.
 *
 * Chave de cache: `${gcsPath}:${hashMd5}` — quando o arquivo muda no GCS
 * e o P01 grava um novo hash, o cache miss ocorre automaticamente.
 * Isso torna a invalidação explícita desnecessária em cenários normais.
 *
 * Limite: MAX_ENTRIES × ~5 MB ≈ 100 MB RAM.
 * Para escala horizontal (múltiplas instâncias Cloud Run): substituir por Redis.
 */
@Injectable()
export class ParquetCacheService {
  private static readonly MAX_ENTRIES = 20;
  private static readonly TTL_MS      = 60 * 60 * 1000; // 1 hora

  private readonly cache = new Map<string, CacheEntry>();

  /** Chave canônica: inclui hash para invalidação automática ao reprocessar. */
  static buildKey(gcsPath: string, hashMd5: string): string {
    return `${gcsPath}:${hashMd5}`;
  }

  get(key: string): Buffer | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    // Promove para "mais recente" (semântica LRU via Map insertion order)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.buffer;
  }

  set(key: string, buffer: Buffer): void {
    if (this.cache.size >= ParquetCacheService.MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { buffer, novoSchema: null, expiresAt: Date.now() + ParquetCacheService.TTL_MS });
  }

  /** Retorna o schema detectado anteriormente, ou null se ainda não detectado / entrada ausente. */
  getNovoSchema(key: string): boolean | null {
    const entry = this.cache.get(key);
    if (!entry || Date.now() > entry.expiresAt) return null;
    return entry.novoSchema;
  }

  /** Persiste o schema detectado para evitar a query parquet_schema() nas próximas chamadas. */
  setNovoSchema(key: string, value: boolean): void {
    const entry = this.cache.get(key);
    if (entry) entry.novoSchema = value;
  }

  /** Invalida manualmente — útil em testes ou forçar refresh. */
  invalidate(gcsPath: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${gcsPath}:`)) this.cache.delete(key);
    }
  }
}
