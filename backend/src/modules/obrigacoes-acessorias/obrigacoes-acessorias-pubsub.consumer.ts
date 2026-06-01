import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PubSub, Message } from '@google-cloud/pubsub';
import { ObrigacoesAcessoriasService } from './obrigacoes-acessorias.service';

@Injectable()
export class ObrigacoesAcessoriasPubSubConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ObrigacoesAcessoriasPubSubConsumer.name);
  private readonly client: PubSub;
  private readonly subscriptionName: string;
  private subscription: ReturnType<PubSub['subscription']> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly service: ObrigacoesAcessoriasService,
  ) {
    const projectId = this.config.get<string>('pubsub.projectId') ?? '';
    this.client = new PubSub({ projectId });
    this.subscriptionName =
      this.config.get<string>('pubsub.subscriptionObrigacaoRecebida') ?? '';
  }

  onModuleInit() {
    if (!this.subscriptionName) {
      this.logger.warn(
        'PUBSUB_SUBSCRIPTION_OBRIGACAO_RECEBIDA não configurado — consumer inativo',
      );
      return;
    }
    this.subscription = this.client.subscription(this.subscriptionName);
    this.subscription.on('message', (msg: Message) => void this.handleMessage(msg));
    this.subscription.on('error', (err) =>
      this.logger.error(`Pub/Sub error: ${String(err)}`),
    );
    this.logger.log(`Consumer obrigacao_recebida escutando em ${this.subscriptionName}`);
  }

  /**
   * RN-01/RN-02: sempre faz ack — mensagens inválidas são persistidas como Erro_Validacao
   * pelo service antes de retornar, evitando loop de retry.
   */
  async handleMessage(msg: Message): Promise<void> {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(msg.data.toString()) as Record<string, unknown>;
    } catch (err) {
      this.logger.error(`Payload não é JSON válido — ack para evitar loop: ${String(err)}`);
      msg.ack();
      return;
    }

    try {
      const result = await this.service.processarEventoPubSub(raw);
      // RN-02: resultado sempre tem ack=true (service nunca lança para cá)
      if (result.ack) {
        msg.ack();
        this.logger.debug(`Mensagem acked com status=${result.status}`);
      }
    } catch (err) {
      // Falha inesperada (ex: banco indisponível) — nack para retry
      this.logger.error(`Erro inesperado ao processar evento: ${String(err)}`);
      msg.nack();
    }
  }

  async onModuleDestroy() {
    await this.subscription?.close();
    await this.client.close();
  }
}

