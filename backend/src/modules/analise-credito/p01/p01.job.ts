import { Injectable, Logger } from '@nestjs/common';
import { Cron }               from '@nestjs/schedule';
import { InjectQueue }        from '@nestjs/bull';
import { Queue }              from 'bull';
import { PrismaService }      from '../../../database/prisma.service';
import { P01Service }         from './p01.service';
import { AC_PIPELINE_QUEUE, AcPipelineJobData, acPipelineJobId, acPipelineJobIdCnpj } from '../analise-credito-queue.constants';

/**
 * Cron job P01 — roda diariamente às 02h e detecta CNPJs/exercícios
 * ainda não processados na tabela de controle (idempotência via versao_prompt).
 *
 * Após P01 concluir, enfileira um job no AC_PIPELINE_QUEUE para que o worker
 * execute P02→P03→P04 de forma assíncrona, sem bloquear a instância API.
 */
@Injectable()
export class P01Job {
  private readonly logger = new Logger(P01Job.name);
  private running = false;

  estaRodando() { return this.running; }

  constructor(
    private readonly prisma:         PrismaService,
    private readonly p01Service:     P01Service,
    @InjectQueue(AC_PIPELINE_QUEUE)
    private readonly pipelineQueue:  Queue<AcPipelineJobData>,
  ) {}

  /** Cron diário às 02:15 */
  @Cron('15 2 * * *', { name: 'p01-diario' })
  async executarDiario(): Promise<void> {
    await this.executar();
  }

  /**
   * Processa um único CNPJ via P01 e enfileira P02→P04.
   * Usado pelo endpoint por-CNPJ e pelo listener de auto-trigger ECF.
   */
  async dispararPorCnpj(tenantId: string, cnpj: string): Promise<void> {
    if (this.running) {
      this.logger.warn(`[P01 Job] dispararPorCnpj ignorado — pipeline já em execução (tenant=${tenantId})`);
      return;
    }
    this.running = true;
    try {
      this.logger.log(`[P01 Job] dispararPorCnpj tenant=${tenantId}`);
      await this.p01Service.processarCnpj(tenantId, cnpj);
      await this.pipelineQueue.add(
        { tenantId },
        { jobId: acPipelineJobIdCnpj(tenantId, cnpj), removeOnComplete: 50, removeOnFail: 100 },
      );
      this.logger.log(`[P01 Job] Pipeline P02→P04 enfileirado para tenant=${tenantId}`);
    } finally {
      this.running = false;
    }
  }

  /** Disparado também pelo controller para execução manual */
  async executar(tenantId?: string): Promise<void> {
    if (this.running) {
      this.logger.warn('[P01 Job] Já em execução — ignorando disparo');
      return;
    }
    this.running = true;
    this.logger.log('[P01 Job] Iniciando processamento');

    try {
      const tenants = tenantId
        ? [{ id: tenantId }]
        : await this.prisma.tenant.findMany({ where: { ativo: true }, select: { id: true } });

      for (const tenant of tenants) {
        this.logger.log(`[P01 Job] Processando tenant ${tenant.id}`);

        const r1 = await this.p01Service.processarTodos(tenant.id);
        this.logger.log(
          `[P01] tenant=${tenant.id} ok=${r1.filter(r=>r.status==='ok').length} ` +
          `pulados=${r1.filter(r=>r.status==='pulado').length}`
        );

        // Enfileira P02→P04 no worker. jobId fixo por tenant garante idempotência
        // (job duplicado para o mesmo tenant é ignorado enquanto o anterior aguarda).
        await this.pipelineQueue.add(
          { tenantId: tenant.id },
          { jobId: acPipelineJobId(tenant.id), removeOnComplete: 50, removeOnFail: 100 },
        );
        this.logger.log(`[P01 Job] Pipeline P02→P04 enfileirado para tenant ${tenant.id}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[P01 Job] Erro inesperado: ${msg}`, err instanceof Error ? err.stack : undefined);
    } finally {
      this.running = false;
    }
  }
}
