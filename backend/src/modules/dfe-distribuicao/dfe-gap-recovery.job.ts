import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { DfeGapStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { DFE_GAP_QUEUE, DfeGapJobData, dfeJobId } from './dfe-queue.constants';

/**
 * Scheduler de recuperação de gaps NSU — MOC 7.0 seção 5.7.4.5.
 *
 * Executa a cada 30 minutos, busca gaps PENDENTES elegíveis (máximo 20,
 * 1 por CNPJ por ciclo) e enfileira um job dfe:gap para cada um.
 *
 * O processamento real (consNSU + persistência) é feito por DfeGapWorker.
 */
@Injectable()
export class DfeGapRecoveryJob {
  private readonly logger = new Logger(DfeGapRecoveryJob.name);

  private readonly GAPS_POR_CICLO = 20;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(DFE_GAP_QUEUE) private readonly gapQueue: Queue<DfeGapJobData>,
  ) {}

  @Cron('*/30 * * * *', { name: 'dfe-gap-recovery' })
  async recuperarGaps(): Promise<void> {
    const gaps = await this.buscarGapsPendentes();

    if (gaps.length === 0) {
      this.logger.debug('Nenhum gap pendente encontrado.');
      return;
    }

    this.logger.log(`${gaps.length} gap(s) elegíveis — enfileirando dfe:gap...`);

    let enfileirados = 0;
    for (const gap of gaps) {
      const jobId = dfeJobId.gap(gap.config.tenantId, gap.id);

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
          backoff: { type: 'exponential', delay: 3_600_000 }, // 1h, 2h, 4h
          removeOnComplete: 200,
          removeOnFail: 100,
        },
      );

      enfileirados++;
    }

    if (enfileirados > 0) {
      this.logger.log(`${enfileirados} job(s) dfe:gap enfileirado(s).`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────

  private async buscarGapsPendentes() {
    const agora = new Date();

    const candidatos = await this.prisma.dfeGapNsu.findMany({
      where: {
        status: DfeGapStatus.PENDENTE,
        proximaTentativa: { lte: agora },
      },
      orderBy: [{ proximaTentativa: 'asc' }, { nsuFaltante: 'asc' }],
      take: this.GAPS_POR_CICLO * 5,
      include: {
        config: { select: { id: true, tenantId: true, cnpj: true } },
      },
    });

    // Deduplica: mantém 1 gap por configId (o mais antigo)
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
