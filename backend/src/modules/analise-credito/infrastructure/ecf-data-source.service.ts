import { Injectable, Logger } from '@nestjs/common';
import { PrismaService }       from '../../../database/prisma.service';
import { P01GcsService }       from '../p01/p01-gcs.service';
import { EcfParquetRepository, EcfConsultaOptions } from './duckdb/ecf-parquet.repository';
import { ParquetCacheService } from './cache/parquet-cache.service';
import { EcfRegistroRow }      from '../p01/p01-ecf.parser';
import { withRetry }           from '../shared/with-retry';

/**
 * Fonte única de dados ECF para P02 e demonstrações.
 *
 * Cadeia de prioridade por empresa/exercício:
 *   1. Parquet no GCS  (creditoEcfArquivo → GCS download → DuckDB query)
 *   2. Banco relacional (creditoEcfRegistros — dados anteriores à migração)
 *
 * O cache de buffer evita downloads repetidos durante a mesma sessão.
 */
@Injectable()
export class EcfDataSourceService {
  private readonly logger = new Logger(EcfDataSourceService.name);

  constructor(
    private readonly prisma:     PrismaService,
    private readonly gcs:        P01GcsService,
    private readonly parquetRepo: EcfParquetRepository,
    private readonly cache:      ParquetCacheService,
  ) {}

  // ─── API pública ────────────────────────────────────────────────────────────

  async consultar(empresaId: string, exercicio: number, opts: EcfConsultaOptions = {}): Promise<EcfRegistroRow[]> {
    const buffer = await this.obterBufferParquet(empresaId, exercicio);
    if (buffer) {
      return this.parquetRepo.consultar(buffer, opts);
    }
    return this.consultarDb(empresaId, exercicio, opts);
  }

  async trimestresDisponiveis(empresaId: string, exercicio: number, registroEcf: string): Promise<number[]> {
    const buffer = await this.obterBufferParquet(empresaId, exercicio);
    if (buffer) {
      return this.parquetRepo.trimestresDisponiveis(buffer, registroEcf);
    }
    return this.trimestresDisponiveisDb(empresaId, exercicio, registroEcf);
  }

  /** Invalida o cache de um Parquet após reprocessamento. */
  invalidarCache(gcsPath: string): void {
    this.cache.invalidate(gcsPath);
  }

  // ─── Parquet (fonte primária) ────────────────────────────────────────────────

  private async obterBufferParquet(empresaId: string, exercicio: number): Promise<Buffer | null> {
    const arquivo = await this.prisma.creditoEcfArquivo.findUnique({
      where: { empresaId_exercicio: { empresaId, exercicio } },
      select: { gcsPath: true },
    });
    if (!arquivo) return null;

    const cached = this.cache.get(arquivo.gcsPath);
    if (cached) return cached;

    try {
      const { buffer } = await withRetry(
        () => this.gcs.download(arquivo.gcsPath),
        { label: `GCS download Parquet ${arquivo.gcsPath}`, maxAttempts: 3, baseDelayMs: 500 },
      );
      this.cache.set(arquivo.gcsPath, buffer);
      return buffer;
    } catch (err) {
      this.logger.warn(
        `Falha ao baixar Parquet ${arquivo.gcsPath} — usando fallback DB. ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  // ─── Fallback: banco relacional ─────────────────────────────────────────────

  private async consultarDb(empresaId: string, exercicio: number, opts: EcfConsultaOptions): Promise<EcfRegistroRow[]> {
    const rows = await this.prisma.creditoEcfRegistro.findMany({
      where: {
        empresaId,
        exercicio,
        ...(opts.registroEcf        ? { registroEcf: opts.registroEcf }                         : {}),
        ...(opts.trimestre !== undefined ? { trimestre: opts.trimestre }                          : {}),
        ...(opts.linhaCodigoPrefixo ? { linhaCodigo: { startsWith: opts.linhaCodigoPrefixo } }  : {}),
      },
      orderBy: { linhaCodigo: 'asc' },
    });

    return rows.map(r => ({
      registroEcf: r.registroEcf,
      trimestre:   r.trimestre,
      linhaCodigo: r.linhaCodigo,
      descricao:   r.descricao,
      valor:       r.valor.toNumber(),
      status:      r.status,
    }));
  }

  private async trimestresDisponiveisDb(empresaId: string, exercicio: number, registroEcf: string): Promise<number[]> {
    const rows = await this.prisma.creditoEcfRegistro.findMany({
      where:    { empresaId, exercicio, registroEcf },
      select:   { trimestre: true },
      distinct: ['trimestre'],
      orderBy:  { trimestre: 'asc' },
    });
    return rows.map(r => r.trimestre);
  }
}
