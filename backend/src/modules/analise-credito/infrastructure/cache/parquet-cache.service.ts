import { Injectable } from '@nestjs/common';

interface CacheEntry {
  buffer:    Buffer;
  expiresAt: number;
}

/**
 * Cache LRU in-memory para buffers Parquet.
 * Evita downloads repetidos do GCS para a mesma empresa/exercício.
 *
 * Limite: MAX_ENTRIES × ~5 MB ≈ 100 MB RAM.
 * Para escala horizontal (múltiplas instâncias), substituir por Redis.
 */
@Injectable()
export class ParquetCacheService {
  private static readonly MAX_ENTRIES = 20;
  private static readonly TTL_MS      = 60 * 60 * 1000; // 1 hora

  private readonly cache = new Map<string, CacheEntry>();

  get(key: string): Buffer | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    // Promove para "mais recente" (semântica LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.buffer;
  }

  set(key: string, buffer: Buffer): void {
    if (this.cache.size >= ParquetCacheService.MAX_ENTRIES) {
      // Evicta o mais antigo (Map preserva ordem de inserção)
      this.cache.delete(this.cache.keys().next().value!);
    }
    this.cache.set(key, { buffer, expiresAt: Date.now() + ParquetCacheService.TTL_MS });
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }
}
