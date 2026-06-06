import { Injectable, Logger } from '@nestjs/common';
import { PrismaService }       from '../../../database/prisma.service';
import { P01GcsService }       from '../p01/p01-gcs.service';
import { EcfParquetRepository, EcfConsultaOptions, EcfConsultaResult } from './duckdb/ecf-parquet.repository';
import { ParquetCacheService } from './cache/parquet-cache.service';
import { EcfRegistroRow }      from '../p01/p01-ecf.parser';
import { withRetry, isGcsPermanentError } from '../shared/with-retry';

/**
 * Fonte única de dados ECF para P02 e demonstrações.
 *
 * Cadeia de prioridade por empresa/exercício:
 *   1. Parquet no GCS  (creditoEcfArquivo → download → DuckDB)
 *   2. Banco relacional (creditoEcfRegistros — dados anteriores à migração)
 *
 * Cache: chave = `${gcsPath}:${hashMd5}` — invalidação automática quando o
 * arquivo é reprocessado (novo hash). Não requer invalidação explícita.
 */
@Injectable()
export class EcfDataSourceService {
  private readonly logger = new Logger(EcfDataSourceService.name);

  constructor(
    private readonly prisma:      PrismaService,
    private readonly gcs:         P01GcsService,
    private readonly parquetRepo: EcfParquetRepository,
    private readonly cache:       ParquetCacheService,
  ) {}

  // ─── API principal ──────────────────────────────────────────────────────────

  /**
   * Consulta otimizada que retorna trimestres + registros numa única operação.
   * O buffer Parquet é escrito em /tmp apenas uma vez por chamada.
   * Retorna null se não há dados para o registroEcf informado.
   */
  async consultarComTrimestres(
    empresaId:   string,
    exercicio:   number,
    registroEcf: string,
    trimestre?:  number,
    linhaCodigoPrefixo?: string,
  ): Promise<EcfConsultaResult | null> {
    const buffer = await this.obterBuffer(empresaId, exercicio);
    if (buffer) {
      return this.parquetRepo.consultarComTrimestres(buffer, {
        registroEcf,
        trimestre,
        linhaCodigoPrefixo,
      });
    }
    return this.consultarComTrimestresDb(empresaId, exercicio, registroEcf, trimestre, linhaCodigoPrefixo);
  }

  async consultar(empresaId: string, exercicio: number, opts: EcfConsultaOptions = {}): Promise<EcfRegistroRow[]> {
    const buffer = await this.obterBuffer(empresaId, exercicio);
    if (buffer) return this.parquetRepo.consultar(buffer, opts);
    return this.consultarDb(empresaId, exercicio, opts);
  }

  async trimestresDisponiveis(empresaId: string, exercicio: number, registroEcf: string): Promise<number[]> {
    const buffer = await this.obterBuffer(empresaId, exercicio);
    if (buffer) return this.parquetRepo.trimestresDisponiveis(buffer, registroEcf);
    return this.trimestresDisponiveisDb(empresaId, exercicio, registroEcf);
  }

  /** Invalida cache explicitamente (ex: logo após reprocessamento P01). */
  invalidarCache(gcsPath: string): void {
    this.cache.invalidate(gcsPath);
  }

  // ─── Parquet (fonte primária) ────────────────────────────────────────────────

  private async obterBuffer(empresaId: string, exercicio: number): Promise<Buffer | null> {
    const arquivo = await this.prisma.creditoEcfArquivo.findUnique({
      where:  { empresaId_exercicio: { empresaId, exercicio } },
      select: { gcsPath: true, hashMd5: true },
    });
    if (!arquivo) return null;

    const cacheKey = ParquetCacheService.buildKey(arquivo.gcsPath, arquivo.hashMd5);
    const cached   = this.cache.get(cacheKey);
    if (cached) return cached;

    try {
      const { buffer } = await withRetry(
        () => this.gcs.download(arquivo.gcsPath),
        {
          label:       `GCS download Parquet ${arquivo.gcsPath}`,
          logger:      this.logger,
          isRetryable: (err) => !isGcsPermanentError(err),
        },
      );
      this.cache.set(cacheKey, buffer);
      return buffer;
    } catch (err) {
      this.logger.warn(
        `Falha ao baixar Parquet ${arquivo.gcsPath} — usando fallback DB. ` +
        (err instanceof Error ? err.message : JSON.stringify(err)),
      );
      return null;
    }
  }

  // ─── Fallback: banco relacional ─────────────────────────────────────────────

  private async consultarComTrimestresDb(
    empresaId:           string,
    exercicio:           number,
    registroEcf:         string,
    trimestreReq?:       number,
    linhaCodigoPrefixo?: string,
  ): Promise<EcfConsultaResult | null> {
    const trimestresRows = await this.prisma.creditoEcfRegistro.findMany({
      where:    { empresaId, exercicio, registroEcf },
      select:   { trimestre: true },
      distinct: ['trimestre'],
      orderBy:  { trimestre: 'asc' },
    });
    const trimestres = trimestresRows.map(r => r.trimestre);
    if (trimestres.length === 0) return null;

    const trimestreAtivo = trimestreReq !== undefined && trimestres.includes(trimestreReq)
      ? trimestreReq
      : Math.max(...trimestres);

    const rows = await this.consultarDb(empresaId, exercicio, {
      registroEcf,
      trimestre: trimestreAtivo,
      linhaCodigoPrefixo,
    });
    return { trimestres, trimestreAtivo, registros: rows };
  }

  private async consultarDb(empresaId: string, exercicio: number, opts: EcfConsultaOptions): Promise<EcfRegistroRow[]> {
    const rows = await this.prisma.creditoEcfRegistro.findMany({
      where: {
        empresaId,
        exercicio,
        ...(opts.registroEcf             ? { registroEcf: opts.registroEcf }                         : {}),
        ...(opts.trimestre !== undefined  ? { trimestre: opts.trimestre }                              : {}),
        ...(opts.linhaCodigoPrefixo      ? { linhaCodigo: { startsWith: opts.linhaCodigoPrefixo } }  : {}),
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
