import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { CTE_WORKER_DEFAULTS } from './cte.types';
import { CTE_RESUMO_QUEUE, CteResumoJobData, cteJobId } from './cte-queue.constants';

/**
 * Scheduler leve do CT-e — só enfileira jobs cte:resumo para cada CNPJ elegível.
 * O processamento real acontece no CteResumoWorker (worker separado).
 */
@Injectable()
export class CteDistribuicaoJob {
  private readonly logger = new Logger(CteDistribuicaoJob.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(CTE_RESUMO_QUEUE) private readonly resumoQueue: Queue<CteResumoJobData>,
  ) {}

  @Cron('* * * * *', { name: 'cte-scheduler' })
  async executar(): Promise<void> {
    const agora = new Date();
    const minutosAgora = agora.getHours() * 60 + agora.getMinutes();

    const configs = await this.prisma.cteConfig.findMany({
      where: {
        ativo: true,
        controle: {
          OR: [{ proximaConsulta: null }, { proximaConsulta: { lte: agora } }],
          emProcessamento: false,
          errosConsecutivos: { lt: CTE_WORKER_DEFAULTS.maxErrosConsecutivos },
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
      const cicloTs = config.controle?.proximaConsulta?.getTime() ?? 'first';
      const jobId = `${cteJobId.resumo(config.tenantId, config.cnpj)}:${cicloTs}`;

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
      this.logger.log(`CT-e scheduler: ${enfileirados} job(s) enfileirado(s) de ${elegiveis.length} elegível(eis)`);
    }
  }

  @Cron('0 * * * *', { name: 'cte-manutencao' })
  async manutencao(): Promise<void> {
    const pausaLimite = new Date(Date.now() - CTE_WORKER_DEFAULTS.pausaErrosMinutos * 60_000);

    const resetados = await this.prisma.$executeRaw`
      UPDATE cte_nsu_controles
      SET erros_consecutivos = 0, ultimo_erro = NULL, ultimo_erro_em = NULL
      WHERE
        erros_consecutivos >= ${CTE_WORKER_DEFAULTS.maxErrosConsecutivos}
        AND ultimo_erro_em < ${pausaLimite}
    `;

    if (resetados > 0) {
      this.logger.log(`Circuit breaker (CT-e): ${resetados} CNPJ(s) reativado(s)`);
    }
  }
}
