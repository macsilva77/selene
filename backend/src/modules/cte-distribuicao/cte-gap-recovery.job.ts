import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { CteGapStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CTE_GAP_QUEUE, CteGapJobData, cteJobId } from './cte-queue.constants';

/**
 * Scheduler de recuperação de gaps NSU do CT-e. Executa a cada 30 minutos,
 * busca gaps PENDENTES elegíveis (máx 20, 1 por CNPJ) e enfileira cte:gap.
 */
@Injectable()
export class CteGapRecoveryJob {
  private readonly logger = new Logger(CteGapRecoveryJob.name);

  private readonly GAPS_POR_CICLO = 20;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(CTE_GAP_QUEUE) private readonly gapQueue: Queue<CteGapJobData>,
  ) {}

  @Cron('*/30 * * * *', { name: 'cte-gap-recovery' })
  async recuperarGaps(): Promise<void> {
    const gaps = await this.buscarGapsPendentes();
    if (gaps.length === 0) return;

    this.logger.log(`${gaps.length} gap(s) CT-e elegíveis — enfileirando cte:gap...`);

    let enfileirados = 0;
    for (const gap of gaps) {
      const jobId = cteJobId.gap(gap.config.tenantId, gap.id);

      const existente = await this.gapQueue.getJob(jobId);
      if (existente) {
        const state = await existente.getState();
        if (state === 'waiting' || state === 'active' || state === 'delayed') continue;
      }

      await this.gapQueue.add(
        {
          tenantId: gap.config.tenantId,
          cnpj: gap.config.cnpj,
          gapId: gap.id,
          nsuFaltante: gap.nsuFaltante,
          configId: gap.configId,
        },
        {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 3_600_000 },
          removeOnComplete: 200,
          removeOnFail: 100,
        },
      );
      enfileirados++;
    }

    if (enfileirados > 0) {
      this.logger.log(`${enfileirados} job(s) cte:gap enfileirado(s).`);
    }
  }

  private async buscarGapsPendentes() {
    const agora = new Date();

    const candidatos = await this.prisma.cteGapNsu.findMany({
      where: { status: CteGapStatus.PENDENTE, proximaTentativa: { lte: agora } },
      orderBy: [{ proximaTentativa: 'asc' }, { nsuFaltante: 'asc' }],
      take: this.GAPS_POR_CICLO * 5,
      include: { config: { select: { id: true, tenantId: true, cnpj: true } } },
    });

    const vistos = new Set<string>();
    const selecionados: typeof candidatos = [];

    for (const gap of candidatos) {
      if (!vistos.has(gap.configId)) {
        vistos.add(gap.configId);
        selecionados.push(gap);
        if (selecionados.length >= this.GAPS_POR_CICLO) break;
      }
    }

    return selecionados;
  }
}
