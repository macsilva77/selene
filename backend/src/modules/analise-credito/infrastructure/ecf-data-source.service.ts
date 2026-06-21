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
 * Fonte: Parquet no GCS (creditoEcfArquivo → download → DuckDB).
 *
 * Débito 5: o fallback para o banco relacional (creditoEcfRegistros, com
 * naturezaFinal='D' hardcoded) foi removido — a medição do parque (5a) mostrou
 * 0 empresas dependentes desse caminho e P01 não escreve mais nessa tabela.
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

  // Cache de resultados: evita queries DuckDB repetidas para mesma combinação de parâmetros.
  // Chave: `${gcsPath}:${md5}:${registroEcf}:${trimestre ?? 'x'}:${prefixo ?? ''}`
  private readonly resultCache = new Map<string, { result: EcfConsultaResult | null; expiresAt: number }>();
  private static readonly RESULT_TTL_MS = 10 * 60 * 1000; // 10 min

  private buildResultKey(cacheKey: string, registroEcf: string, trimestre?: number, prefixo?: string): string {
    return `${cacheKey}:${registroEcf}:${trimestre ?? 'x'}:${prefixo ?? ''}`;
  }

  /**
   * Consulta otimizada que retorna trimestres + registros numa única operação.
   * O buffer Parquet é escrito em /tmp apenas uma vez por chamada.
   * O schema DuckDB e os resultados são cacheados — chamadas repetidas custam O(1).
   * Retorna null se não há dados para o registroEcf informado.
   */
  async consultarComTrimestres(
    empresaId:   string,
    exercicio:   number,
    registroEcf: string,
    trimestre?:  number,
    linhaCodigoPrefixo?: string,
  ): Promise<EcfConsultaResult | null> {
    const arquivo = await this.prisma.creditoEcfArquivo.findUnique({
      where:  { empresaId_exercicio: { empresaId, exercicio } },
      select: { gcsPath: true, hashMd5: true },
    });

    if (arquivo) {
      const cacheKey  = ParquetCacheService.buildKey(arquivo.gcsPath, arquivo.hashMd5);
      const resultKey = this.buildResultKey(cacheKey, registroEcf, trimestre, linhaCodigoPrefixo);

      // Cache hit: retorna sem tocar no disco ou no DuckDB
      const cached = this.resultCache.get(resultKey);
      if (cached && Date.now() < cached.expiresAt) return cached.result;

      const buffer = await this.obterBufferDireto(arquivo.gcsPath, arquivo.hashMd5, cacheKey);
      if (buffer) {
        const resultado = await this.parquetRepo.consultarComTrimestres(buffer, {
          registroEcf,
          trimestre,
          linhaCodigoPrefixo,
          cachedNovoSchema: this.cache.getNovoSchema(cacheKey),
        });
        // Persiste schema detectado para próximas chamadas
        if (resultado) this.cache.setNovoSchema(cacheKey, resultado.novoSchema);
        // Anotar origem antes de cachear
        const resultadoComOrigem = resultado ? { ...resultado, origemDados: 'ecf_fresco' as const } : null;
        this.resultCache.set(resultKey, { result: resultadoComOrigem, expiresAt: Date.now() + EcfDataSourceService.RESULT_TTL_MS });
        return resultadoComOrigem;
      }
    }

    // Sem arquivo Parquet (ou download falhou): não há fonte. Ver Débito 5 no cabeçalho.
    return null;
  }

  async consultar(empresaId: string, exercicio: number, opts: EcfConsultaOptions = {}): Promise<EcfRegistroRow[]> {
    const buffer = await this.obterBuffer(empresaId, exercicio);
    if (buffer) return this.parquetRepo.consultar(buffer, opts);
    return [];
  }

  async trimestresDisponiveis(empresaId: string, exercicio: number, registroEcf: string): Promise<number[]> {
    const buffer = await this.obterBuffer(empresaId, exercicio);
    if (buffer) return this.parquetRepo.trimestresDisponiveis(buffer, registroEcf);
    return [];
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
    if (arquivo === null) return null;

    const cacheKey = ParquetCacheService.buildKey(arquivo.gcsPath, arquivo.hashMd5);
    return this.obterBufferDireto(arquivo.gcsPath, arquivo.hashMd5, cacheKey);
  }

  /** Baixa (ou retorna do cache) o buffer Parquet dado gcsPath + hash já conhecidos. */
  private async obterBufferDireto(gcsPath: string, hashMd5: string, cacheKey: string): Promise<Buffer | null> {
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    try {
      const { buffer } = await withRetry(
        () => this.gcs.download(gcsPath),
        {
          label:       `GCS download Parquet ${gcsPath}`,
          logger:      this.logger,
          isRetryable: (err) => isGcsPermanentError(err) === false,
        },
      );
      this.cache.set(cacheKey, buffer);
      return buffer;
    } catch (err) {
      this.logger.warn(
        `Falha ao baixar Parquet ${gcsPath} — sem dados para este exercício. ` +
        (err instanceof Error ? err.message : JSON.stringify(err)),
      );
      return null;
    }
  }
}
