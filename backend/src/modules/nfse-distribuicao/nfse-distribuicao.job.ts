import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NfseDistribuicaoService } from './nfse-distribuicao.service';
import { NfseNsuControlRepository } from './nfse-nsu-control.repository';

/**
 * Agendador da recepção de NFS-e.
 *
 * A cada 5 minutos dispara os ciclos pendentes (configs ativas cuja
 * proximaConsulta já venceu). A concorrência entre instâncias do Cloud Run é
 * protegida pelo lock distribuído em NfseNsuControle (UPDATE atômico), então
 * múltiplas réplicas executando o cron não processam o mesmo CNPJ em paralelo.
 *
 * Um flag em memória evita sobreposição de ticks na MESMA instância.
 */
@Injectable()
export class NfseDistribuicaoJob {
  private readonly logger = new Logger(NfseDistribuicaoJob.name);
  private executando = false;

  constructor(
    private readonly service: NfseDistribuicaoService,
    private readonly controle: NfseNsuControlRepository,
  ) {}

  @Cron('*/5 * * * *', { name: 'nfse-scheduler' })
  async executar(): Promise<void> {
    if (this.executando) {
      this.logger.debug('Ciclo NFS-e anterior ainda em execução — tick ignorado');
      return;
    }
    this.executando = true;
    try {
      const resumos = await this.service.executarPendentes();
      const comDocs = resumos.filter((r) => r.documentosBaixados > 0);
      if (comDocs.length > 0) {
        const total = comDocs.reduce((s, r) => s + r.documentosBaixados, 0);
        this.logger.log(
          `NFS-e scheduler: ${total} documento(s) recebido(s) em ${comDocs.length} CNPJ(s)`,
        );
      }
    } catch (err) {
      this.logger.error(`Erro no scheduler NFS-e: ${(err as Error).message}`);
    } finally {
      this.executando = false;
    }
  }

  /** A cada hora libera locks órfãos (processo morto sem liberar). */
  @Cron('0 * * * *', { name: 'nfse-manutencao' })
  async manutencao(): Promise<void> {
    await this.controle.liberarLocksExpirados();
  }
}
