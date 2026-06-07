import { Logger } from '@nestjs/common';
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { P02Service } from './p02/p02.service';
import { P03Service } from './p03/p03.service';
import { P04Service } from './p04/p04.service';
import { AC_PIPELINE_QUEUE, AcPipelineJobData } from './analise-credito-queue.constants';

/**
 * Worker que executa P02→P03→P04 de forma assíncrona após o P01Job.
 *
 * Registrado apenas no WorkerAppModule — nunca no processo API, para não
 * criar dois consumidores concorrentes da mesma fila.
 *
 * Idempotência: cada etapa (P02/P03/P04) já verifica internamente se o
 * exercício foi processado (jaProcessado) e pula se necessário.
 */
@Processor(AC_PIPELINE_QUEUE)
export class AnaliseCreditoPipelineProcessor {
  private readonly logger = new Logger(AnaliseCreditoPipelineProcessor.name);

  constructor(
    private readonly p02Service: P02Service,
    private readonly p03Service: P03Service,
    private readonly p04Service: P04Service,
  ) {}

  @Process()
  async handle(job: Job<AcPipelineJobData>): Promise<void> {
    const { tenantId } = job.data;
    this.logger.log(`[Pipeline Worker] job=${job.id} tenant=${tenantId} — iniciando P02`);

    const r2 = await this.p02Service.processarTodos(tenantId);
    this.logger.log(
      `[Pipeline Worker] P02 tenant=${tenantId} ok=${r2.filter(r=>r.status==='ok').length} ` +
      `pulados=${r2.filter(r=>r.status==='pulado').length} ` +
      `bloqueados=${r2.filter(r=>r.status==='bloqueado').length} ` +
      `erros=${r2.filter(r=>r.status==='erro').length}`,
    );

    const r3 = await this.p03Service.processarTodos(tenantId);
    this.logger.log(
      `[Pipeline Worker] P03 tenant=${tenantId} ok=${r3.filter(r=>r.status==='ok').length} ` +
      `pulados=${r3.filter(r=>r.status==='pulado').length} ` +
      `bloqueados=${r3.filter(r=>r.status==='bloqueado').length} ` +
      `erros=${r3.filter(r=>r.status==='erro').length}`,
    );

    const r4 = await this.p04Service.processarTodos(tenantId);
    this.logger.log(
      `[Pipeline Worker] P04 tenant=${tenantId} ok=${r4.filter(r=>r.status==='ok').length} ` +
      `pulados=${r4.filter(r=>r.status==='pulado').length} ` +
      `bloqueados=${r4.filter(r=>r.status==='bloqueado').length} ` +
      `erros=${r4.filter(r=>r.status==='erro').length}`,
    );

    this.logger.log(`[Pipeline Worker] job=${job.id} tenant=${tenantId} — concluído`);
  }
}
