import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { ClientesFornecedoresGcsService } from '../gcs/clientes-fornecedores-gcs.service';
import {
  ClientesFornecedoresParquetRepository,
  RankingParticipanteRow,
  RaizRankingRow,
  DrillDownRow,
} from './clientes-fornecedores-parquet.repository';

// ─── Tipos de parâmetros ──────────────────────────────────────────────────────

export type TipoParticipante = 'CLIENTE' | 'FORNECEDOR';

export interface PeriodoParams {
  tenantId: string;
  empresaId: string;
  anoInicio: number;
  mesInicio: number;
  anoFim: number;
  mesFim: number;
  tipoParticipante: TipoParticipante;
}

export interface ConsultarTopNParams extends PeriodoParams {
  topN?: number;
}

export interface ConsultarPorCnpjParams extends PeriodoParams {
  cnpj: string;
}

export interface ConsultarPorRaizParams extends PeriodoParams {}

export interface ConsultarDrillDownParams extends PeriodoParams {
  cnpjRaiz: string;
}

// ─── Re-exporta tipos de linha para uso pelos controllers ─────────────────────

export type { RankingParticipanteRow, RaizRankingRow, DrillDownRow };

// ─── Serviço ──────────────────────────────────────────────────────────────────

@Injectable()
export class ClientesFornecedoresQueryService {
  private readonly logger = new Logger(ClientesFornecedoresQueryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gcs: ClientesFornecedoresGcsService,
    private readonly parquetRepo: ClientesFornecedoresParquetRepository,
  ) {}

  /** Top N participantes por valor, com ranking e classificação ABC. */
  async consultarTopN(params: ConsultarTopNParams): Promise<RankingParticipanteRow[]> {
    const gcsUris = await this.resolverGcsUris(params);
    if (gcsUris.length === 0) {
      this.logger.warn(
        `Top N: sem Parquets para empresa=${params.empresaId} no período ` +
        `${params.anoInicio}/${params.mesInicio}→${params.anoFim}/${params.mesFim}`,
      );
      return [];
    }
    return this.parquetRepo.consultarRanking(
      gcsUris,
      params.empresaId,
      params.tipoParticipante,
      params.topN,
    );
  }

  /**
   * Participante(s) que correspondem ao CNPJ informado, com sua posição no ranking global
   * e classificação ABC calculada sobre o universo completo do período.
   */
  async consultarPorCnpj(params: ConsultarPorCnpjParams): Promise<RankingParticipanteRow[]> {
    const gcsUris = await this.resolverGcsUris(params);
    if (gcsUris.length === 0) return [];
    return this.parquetRepo.consultarPorCnpj(
      gcsUris,
      params.empresaId,
      params.tipoParticipante,
      params.cnpj,
    );
  }

  /**
   * Ranking consolidado por grupo econômico (raiz CNPJ).
   * Razão social resolvida por prioridade: matriz (sufixo 0001) → maior valor → qualquer.
   */
  async consultarPorRaiz(params: ConsultarPorRaizParams): Promise<RaizRankingRow[]> {
    const gcsUris = await this.resolverGcsUris(params);
    if (gcsUris.length === 0) return [];
    return this.parquetRepo.consultarPorRaiz(
      gcsUris,
      params.empresaId,
      params.tipoParticipante,
    );
  }

  /**
   * Detalhamento de todos os CNPJs de um grupo econômico específico.
   * Inclui percentual dentro do grupo e flag de matriz.
   */
  async consultarDrillDown(params: ConsultarDrillDownParams): Promise<DrillDownRow[]> {
    const gcsUris = await this.resolverGcsUris(params);
    if (gcsUris.length === 0) return [];
    return this.parquetRepo.consultarDrillDown(
      gcsUris,
      params.empresaId,
      params.tipoParticipante,
      params.cnpjRaiz,
    );
  }

  // ─── Resolução de URIs GCS ────────────────────────────────────────────────

  /**
   * Busca no banco quais competências do período têm Parquet gerado e
   * constrói os URIs GCS correspondentes ao tipo (CLIENTE ou FORNECEDOR).
   */
  private async resolverGcsUris(params: PeriodoParams): Promise<string[]> {
    const { tenantId, empresaId, anoInicio, mesInicio, anoFim, mesFim, tipoParticipante } = params;

    const rows = await this.prisma.clientesFornecedoresCompetencia.findMany({
      where: {
        tenantId,
        empresaId,
        ano: { gte: anoInicio, lte: anoFim },
        status: 'PROCESSADO',
      },
      select: {
        ano: true,
        mes: true,
        parquetPathCliente:    true,
        parquetPathFornecedor: true,
      },
      orderBy: [{ ano: 'asc' }, { mes: 'asc' }],
    });

    const ymInicio = anoInicio * 100 + mesInicio;
    const ymFim    = anoFim    * 100 + mesFim;
    const bucketName = this.gcs.getBucketName();

    return rows
      .filter((r) => {
        const ym = r.ano * 100 + r.mes;
        return ym >= ymInicio && ym <= ymFim;
      })
      .map((r) =>
        tipoParticipante === 'CLIENTE' ? r.parquetPathCliente : r.parquetPathFornecedor,
      )
      .filter((p): p is string => p !== null && p !== undefined)
      .map((p) => `gs://${bucketName}/${p}`);
  }
}
