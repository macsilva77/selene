import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { DfeVarreduraStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { DFE_VARREDURA_QUEUE, DfeVarreduraJobData, dfeJobId } from './dfe-queue.constants';

/**
 * Scheduler de varredura retroativa de NSU.
 *
 * Executa a cada minuto e enfileira um job dfe:varredura para cada varredura
 * com status ATIVA e config ativo. O DfeVarreduraWorker processa o lote real
 * (30 NSUs via consNSU com 200ms de delay).
 *
 * Deduplicação via jobId: se o worker ainda estiver processando o lote anterior
 * (estado active/waiting/delayed), o scheduler pula aquele configId.
 */
@Injectable()
export class DfeVarreduraJob {
  private readonly logger = new Logger(DfeVarreduraJob.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(DFE_VARREDURA_QUEUE) private readonly varreduraQueue: Queue<DfeVarreduraJobData>,
  ) {}

  @Cron('* * * * *', { name: 'dfe-varredura-scheduler' })
  async executar(): Promise<void> {
    const ativas = await this.prisma.dfeVarreduraNsu.findMany({
      where: { status: DfeVarreduraStatus.ATIVA },
      select: {
        configId: true,
        tenantId: true,
        cnpj: true,
        config: { select: { ativo: true } },
      },
    });

    if (ativas.length === 0) return;

    let enfileirados = 0;
    for (const v of ativas) {
      if (!v.config.ativo) continue;

      const jobId = dfeJobId.varredura(v.tenantId, v.cnpj);

      const existente = await this.varreduraQueue.getJob(jobId);
      if (existente) {
        const state = await existente.getState();
        if (state === 'waiting' || state === 'active' || state === 'delayed') continue;
      }

      await this.varreduraQueue.add(
        { tenantId: v.tenantId, cnpj: v.cnpj, configId: v.configId },
        {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: 50,
          removeOnFail: 20,
        },
      );
      enfileirados++;
    }

    if (enfileirados > 0) {
      this.logger.debug(`${enfileirados} varredura(s) enfileirada(s).`);
    }
  }
}
