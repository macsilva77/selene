import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';

export type DuckDbParams = Parameters<DuckDBConnection['runAndReadAll']>[1];

const DUCKDB_MEMORY_LIMIT = '512MB';
const DUCKDB_THREADS      = '2';
const QUERY_TIMEOUT_MS    = 30_000;

/**
 * Singleton DuckDB in-memory — instância única compartilhada entre todas as conexões.
 * Múltiplas conexões podem ser abertas concorrentemente.
 *
 * Limites configurados para Cloud Run:
 *   memory_limit = 512MB  — evita OOM Killer
 *   threads = 2           — evita saturação de CPU em queries paralelas
 *
 * Timeout de 30s por query — queries longas encerram a conexão
 * ao invés de bloquear o processo indefinidamente.
 */
@Injectable()
export class DuckDbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DuckDbService.name);
  private instance!: DuckDBInstance;

  async onModuleInit(): Promise<void> {
    this.instance = await DuckDBInstance.create(':memory:', {
      memory_limit: DUCKDB_MEMORY_LIMIT,
      threads:      DUCKDB_THREADS,
    });
    this.logger.log(`DuckDB pronto (memory_limit=${DUCKDB_MEMORY_LIMIT}, threads=${DUCKDB_THREADS})`);
  }

  onModuleDestroy(): void {
    this.instance.closeSync();
    this.logger.log('DuckDB encerrado');
  }

  /** Abre uma conexão nova — caller responsável por `conn.closeSync()`. */
  async connect(): Promise<DuckDBConnection> {
    return this.instance.connect();
  }

  /**
   * Executa SQL parametrizado com timeout e retorna rows como objetos.
   * Abre e fecha a conexão automaticamente.
   *
   * Uso: await duckdb.query('SELECT * FROM read_parquet($1) WHERE col = $2', [path, valor])
   */
  async query<T = Record<string, unknown>>(sql: string, params?: DuckDbParams): Promise<T[]> {
    const conn  = await this.connect();
    const timer = setTimeout(() => {
      this.logger.warn(`[DuckDB] Query timeout após ${QUERY_TIMEOUT_MS}ms — encerrando conexão`);
      conn.closeSync();
    }, QUERY_TIMEOUT_MS);

    try {
      const reader = params === undefined
        ? await conn.runAndReadAll(sql)
        : await conn.runAndReadAll(sql, params);
      return reader.getRowObjects() as unknown as T[];
    } finally {
      clearTimeout(timer);
      conn.closeSync();
    }
  }
}
