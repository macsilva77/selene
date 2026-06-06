import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';

/**
 * Singleton DuckDB — uma instância in-memory compartilhada por todo o processo.
 * Múltiplas conexões podem ser abertas concorrentemente para leituras independentes.
 * Conexão deve ser fechada pelo caller com `conn.closeSync()` após o uso.
 */
@Injectable()
export class DuckDbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DuckDbService.name);
  private instance!: DuckDBInstance;

  async onModuleInit(): Promise<void> {
    this.instance = await DuckDBInstance.create(':memory:');
    this.logger.log('DuckDB pronto (in-memory)');
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
   * Executa SQL e retorna rows como objetos.
   * Abre e fecha a conexão automaticamente.
   */
  async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    const conn = await this.connect();
    try {
      const reader = await conn.runAndReadAll(sql);
      return reader.getRowObjects() as unknown as T[];
    } finally {
      conn.closeSync();
    }
  }
}
