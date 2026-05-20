import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DfeGapStatus, DfeManifestacaoStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Agrega métricas operacionais do módulo DFe e as expõe via endpoint REST
 * (`GET /dfe/metricas`) e como log estruturado a cada hora.
 *
 * Dados retornados (todos filtrados por tenant):
 *  - Configurações: total, ativas, com erros consecutivos
 *  - Documentos: contagem por tipo + total das últimas 24h e 7 dias
 *  - Manifestações: contagem por status
 *  - Gaps NSU: contagem por status
 *  - Desempenho: média/máximo de duração dos lotes das últimas 24h
 *  - Auditoria: erros das últimas 24h
 */
@Injectable()
export class DfeMetricsService {
  private readonly logger = new Logger(DfeMetricsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ────────────────────────────────────────────────────────────────────────────
  // API pública — endpoint REST
  // ────────────────────────────────────────────────────────────────────────────

  async getMetricas(tenantId: string) {
    const [configs, documentos, manifestacoes, gaps, lotes24h, erros24h] =
      await Promise.all([
        this.metricsConfigs(tenantId),
        this.metricsDocumentos(tenantId),
        this.metricsManifestacoes(tenantId),
        this.metricsGaps(tenantId),
        this.metricsLotes(tenantId),
        this.metricsErros(tenantId),
      ]);

    return {
      geradoEm: new Date().toISOString(),
      configs,
      documentos,
      manifestacoes,
      gaps,
      desempenho: lotes24h,
      auditoria: erros24h,
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Log periódico — a cada 1h
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Loga um resumo global das métricas por tenant a cada hora.
   * Utiliza log estruturado (JSON) para fácil ingestão em CloudWatch/ELK.
   */
  @Cron('0 * * * *', { name: 'dfe-metrics-logger' })
  async logMetricas(): Promise<void> {
    // Busca todos os tenants com pelo menos uma DfeConfig
    const tenants = await this.prisma.dfeConfig.findMany({
      distinct: ['tenantId'],
      select: { tenantId: true },
    });

    for (const { tenantId } of tenants) {
      try {
        const m = await this.getMetricas(tenantId);
        this.logger.log(
          `[DFe Metrics] tenant=${tenantId} ` +
          `configs=${m.configs.total}(ativas=${m.configs.ativas}) ` +
          `docs_24h=${m.documentos.ultimas24h} ` +
          `gaps_pendentes=${m.gaps.PENDENTE ?? 0} ` +
          `manifestacoes_pendentes=${m.manifestacoes.PENDENTE ?? 0} ` +
          `erros_24h=${m.auditoria.erros24h} ` +
          `latencia_media_ms=${m.desempenho.duracaoMediaMs ?? '—'}`,
        );
      } catch (err) {
        this.logger.error(
          `Falha ao gerar métricas para tenant ${tenantId}: ${(err as Error).message}`,
        );
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Queries individuais
  // ────────────────────────────────────────────────────────────────────────────

  private async metricsConfigs(tenantId: string) {
    const [total, ativas, comErros] = await Promise.all([
      this.prisma.dfeConfig.count({ where: { tenantId } }),
      this.prisma.dfeConfig.count({ where: { tenantId, ativo: true } }),
      this.prisma.dfeNsuControle.count({
        where: {
          tenantId,
          errosConsecutivos: { gt: 0 },
        },
      }),
    ]);
    return { total, ativas, inativas: total - ativas, comErrosConsecutivos: comErros };
  }

  private async metricsDocumentos(tenantId: string) {
    const agora = new Date();
    const ha24h = new Date(agora.getTime() - 24 * 3_600_000);
    const ha7d = new Date(agora.getTime() - 7 * 24 * 3_600_000);

    const [porTipo, ultimas24h, ultimos7d] = await Promise.all([
      // Contagem por tipo
      this.prisma.dfeDocumento.groupBy({
        by: ['tipoDocumento'],
        where: { tenantId },
        _count: { id: true },
      }),
      // Últimas 24h
      this.prisma.dfeDocumento.count({
        where: { tenantId, criadoEm: { gte: ha24h } },
      }),
      // Últimos 7 dias
      this.prisma.dfeDocumento.count({
        where: { tenantId, criadoEm: { gte: ha7d } },
      }),
    ]);

    const porTipoMap = Object.fromEntries(
      porTipo.map((r) => [r.tipoDocumento, r._count.id]),
    );

    return { porTipo: porTipoMap, ultimas24h, ultimos7d };
  }

  private async metricsManifestacoes(tenantId: string) {
    const grupos = await this.prisma.dfeManifestacao.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: { id: true },
    });

    // Garante que todos os status apareçam, mesmo que com zero
    const base: Record<DfeManifestacaoStatus, number> = {
      PENDENTE: 0,
      ENVIADO: 0,
      REJEITADO: 0,
      ERRO: 0,
    };

    for (const g of grupos) {
      base[g.status] = g._count.id;
    }

    return base;
  }

  private async metricsGaps(tenantId: string) {
    const grupos = await this.prisma.dfeGapNsu.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: { id: true },
    });

    const base: Record<DfeGapStatus, number> = {
      PENDENTE: 0,
      RECUPERADO: 0,
      INEXISTENTE: 0,
      ESGOTADO: 0,
    };

    for (const g of grupos) {
      base[g.status] = g._count.id;
    }

    return base;
  }

  private async metricsLotes(tenantId: string) {
    const ha24h = new Date(Date.now() - 24 * 3_600_000);

    const lotes = await this.prisma.dfeLote.findMany({
      where: {
        tenantId,
        iniciadoEm: { gte: ha24h },
        duracaoMs: { not: null },
      },
      select: { duracaoMs: true, status: true },
    });

    if (lotes.length === 0) {
      return { totalLotes24h: 0, duracaoMediaMs: null, duracaoMaxMs: null, lotesComErro: 0 };
    }

    const duracoes = lotes.map((l) => l.duracaoMs!);
    const soma = duracoes.reduce((a, b) => a + b, 0);
    const max = Math.max(...duracoes);
    const erros = lotes.filter((l) => l.status === 'ERRO').length;

    return {
      totalLotes24h: lotes.length,
      duracaoMediaMs: Math.round(soma / lotes.length),
      duracaoMaxMs: max,
      lotesComErro: erros,
    };
  }

  private async metricsErros(tenantId: string) {
    const ha24h = new Date(Date.now() - 24 * 3_600_000);

    const erros24h = await this.prisma.dfeAuditoria.count({
      where: {
        tenantId,
        sucesso: false,
        criadoEm: { gte: ha24h },
      },
    });

    // Último erro registrado
    const ultimoErro = await this.prisma.dfeAuditoria.findFirst({
      where: { tenantId, sucesso: false },
      orderBy: { criadoEm: 'desc' },
      select: { operacao: true, detalhe: true, cnpj: true, criadoEm: true },
    });

    return { erros24h, ultimoErro };
  }
}
