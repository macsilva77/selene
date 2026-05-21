import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { DFE_WORKER_DEFAULTS } from './dfe.types';
import {
  DFE_RESUMO_QUEUE,
  DfeResumoJobData,
  dfeJobId,
} from './dfe-queue.constants';

/**
 * Scheduler leve — só enfileira jobs dfe:resumo para cada CNPJ elegível.
 * O processamento real acontece no DfeResumoWorker (worker separado).
 *
 * Critérios de elegibilidade (idênticos ao job anterior):
 *  - Config ativa
 *  - proximaConsulta <= agora (ou null na primeira execução)
 *  - emProcessamento = false (fallback PostgreSQL enquanto Redis é fonte primária)
 *  - errosConsecutivos < maxErrosConsecutivos (circuit breaker)
 *  - horarioCaptura respeitado apenas na primeira execução do dia
 */
@Injectable()
export class DfeDistribuicaoJob {
  private readonly logger = new Logger(DfeDistribuicaoJob.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(DFE_RESUMO_QUEUE) private readonly resumoQueue: Queue<DfeResumoJobData>,
  ) {}

  // ────────────────────────────────────────────────────────────────────────────
  // Cron: a cada minuto — enfileira jobs por CNPJ elegível
  // ────────────────────────────────────────────────────────────────────────────

  @Cron('* * * * *', { name: 'dfe-scheduler' })
  async executar(): Promise<void> {
    const agora = new Date();
    const minutosAgora = agora.getHours() * 60 + agora.getMinutes();

    const configs = await this.prisma.dfeConfig.findMany({
      where: {
        ativo: true,
        controle: {
          OR: [
            { proximaConsulta: null },
            { proximaConsulta: { lte: agora } },
          ],
          emProcessamento: false,
          errosConsecutivos: { lt: DFE_WORKER_DEFAULTS.maxErrosConsecutivos },
        },
      },
      select: {
        id: true,
        cnpj: true,
        tenantId: true,
        horarioCaptura: true,
        controle: { select: { proximaConsulta: true } },
      },
      orderBy: { criadoEm: 'asc' },
    });

    const elegiveis = configs.filter((c) => {
      if (c.controle?.proximaConsulta != null) return true;
      const [h, m] = c.horarioCaptura.split(':').map(Number);
      return minutosAgora >= ((h ?? 0) * 60 + (m ?? 0));
    });

    if (elegiveis.length === 0) return;

    let enfileirados = 0;
    for (const config of elegiveis) {
      // jobId único por ciclo: inclui timestamp de proximaConsulta (ou "first" na 1ª execução).
      // Isso elimina conflito com jobs concluídos/falhos de ciclos anteriores — cada ciclo
      // tem seu próprio ID, sem necessidade de remove() antes do add().
      const cicloTs = config.controle?.proximaConsulta?.getTime() ?? 'first';
      const jobId = `${dfeJobId.resumo(config.tenantId, config.cnpj)}:${cicloTs}`;

      // Garante que não há job waiting/active/delayed para este ciclo exato
      const existente = await this.resumoQueue.getJob(jobId);
      if (existente) {
        const state = await existente.getState();
        if (state === 'waiting' || state === 'active' || state === 'delayed') continue;
      }

      await this.resumoQueue.add(
        { tenantId: config.tenantId, cnpj: config.cnpj, configId: config.id },
        {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: true,
          removeOnFail: 50,
        },
      );
      enfileirados++;
    }

    if (enfileirados > 0) {
      this.logger.log(`DFe scheduler: ${enfileirados} job(s) enfileirado(s) de ${elegiveis.length} elegível(eis)`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Cron: a cada hora — reseta circuit breaker de CNPJs pausados
  // ────────────────────────────────────────────────────────────────────────────

  @Cron('0 * * * *', { name: 'dfe-manutencao' })
  async manutencao(): Promise<void> {
    const pausaLimite = new Date(
      Date.now() - DFE_WORKER_DEFAULTS.pausaErrosMinutos * 60_000,
    );

    const resetados = await this.prisma.$executeRaw`
      UPDATE dfe_nsu_controles
      SET erros_consecutivos = 0, ultimo_erro = NULL, ultimo_erro_em = NULL
      WHERE
        erros_consecutivos >= ${DFE_WORKER_DEFAULTS.maxErrosConsecutivos}
        AND ultimo_erro_em < ${pausaLimite}
    `;

    if (resetados > 0) {
      this.logger.log(`Circuit breaker: ${resetados} CNPJ(s) reativado(s) após ${DFE_WORKER_DEFAULTS.pausaErrosMinutos}min`);
    }
  }
}
