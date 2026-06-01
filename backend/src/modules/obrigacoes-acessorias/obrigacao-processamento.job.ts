import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ObrigacaoProcessamentoService } from './obrigacao-processamento.service';

/**
 * Job agendado que dispara o processamento das obrigações com status "Recebido".
 * Frequência padrão: a cada 5 minutos.
 * Pode também ser invocado manualmente via Controller interno ou evento Pub/Sub.
 */
@Injectable()
export class ObrigacaoProcessamentoJob {
  private readonly logger = new Logger(ObrigacaoProcessamentoJob.name);
  private isRunning = false;

  constructor(private readonly processamento: ObrigacaoProcessamentoService) {}

  @Cron('*/5 * * * *', { name: 'obrigacao-processamento' })
  async executar(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Job já em execução — pulando este ciclo.');
      return;
    }

    this.isRunning = true;
    try {
      const resultados = await this.processamento.processarPendentes();
      if (resultados.length > 0) {
        this.logger.log(`Job concluído: ${resultados.length} registro(s) processados.`);
      }
    } catch (err) {
      this.logger.error(`Falha no job de processamento: ${String(err)}`);
    } finally {
      this.isRunning = false;
    }
  }
}
