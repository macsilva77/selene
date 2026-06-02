import { Injectable, Logger } from '@nestjs/common';
import { Cron }               from '@nestjs/schedule';
import { PrismaService }      from '../../../database/prisma.service';
import { P01Service }         from './p01.service';
import { P02Service }         from '../p02/p02.service';
import { P03Service }         from '../p03/p03.service';
import { P04Service }         from '../p04/p04.service';

/**
 * Cron job P01 — roda diariamente às 02h e detecta CNPJs/exercícios
 * ainda não processados na tabela de controle (idempotência via versao_prompt).
 */
@Injectable()
export class P01Job {
  private readonly logger = new Logger(P01Job.name);
  private running = false;

  constructor(
    private readonly prisma:      PrismaService,
    private readonly p01Service:  P01Service,
    private readonly p02Service:  P02Service,
    private readonly p03Service:  P03Service,
    private readonly p04Service:  P04Service,
  ) {}

  /** Disparo automático: todo dia às 02:15 */
  @Cron('15 2 * * *', { name: 'p01-diario' })
  async executarDiario(): Promise<void> {
    await this.executar();
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
      // Descobre o(s) tenant(s) alvo
      const tenants = tenantId
        ? [{ id: tenantId }]
        : await this.prisma.tenant.findMany({ where: { ativo: true }, select: { id: true } });

      for (const tenant of tenants) {
        this.logger.log(`[P01 Job] Processando tenant ${tenant.id}`);

        // P01 → extração ECD/ECF
        const r1 = await this.p01Service.processarTodos(tenant.id);
        this.logger.log(
          `[P01] tenant=${tenant.id} ok=${r1.filter(r=>r.status==='ok').length} ` +
          `pulados=${r1.filter(r=>r.status==='pulado').length}`
        );

        // P02 → balanço + DRE
        const r2 = await this.p02Service.processarTodos(tenant.id);
        this.logger.log(
          `[P02] tenant=${tenant.id} ok=${r2.filter(r=>r.status==='ok').length} ` +
          `pulados=${r2.filter(r=>r.status==='pulado').length}`
        );

        // P03 → indicadores financeiros
        const r3 = await this.p03Service.processarTodos(tenant.id);
        this.logger.log(
          `[P03] tenant=${tenant.id} ok=${r3.filter(r=>r.status==='ok').length} ` +
          `pulados=${r3.filter(r=>r.status==='pulado').length}`
        );

        // P04 → alertas e classificação de risco
        const r4 = await this.p04Service.processarTodos(tenant.id);
        this.logger.log(
          `[P04] tenant=${tenant.id} ok=${r4.filter(r=>r.status==='ok').length} ` +
          `pulados=${r4.filter(r=>r.status==='pulado').length}`
        );
      }
    } catch (err) {
      this.logger.error(`[P01 Job] Erro inesperado: ${err}`);
    } finally {
      this.running = false;
    }
  }
}
