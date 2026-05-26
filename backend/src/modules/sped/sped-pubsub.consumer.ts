import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PubSub, Message } from '@google-cloud/pubsub';
import { SpedService, SpedProcessadoPayload } from './sped.service';

@Injectable()
export class SpedPubSubConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SpedPubSubConsumer.name);
  private readonly client: PubSub;
  private readonly subscriptionName: string;
  private subscription: ReturnType<PubSub['subscription']> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly spedService: SpedService,
  ) {
    const projectId = this.config.get<string>('pubsub.projectId') ?? '';
    this.client = new PubSub({ projectId });
    this.subscriptionName = this.config.get<string>('pubsub.subscriptionSpedProcessado') ?? '';
  }

  onModuleInit() {
    if (!this.subscriptionName) {
      this.logger.warn('PUBSUB_SUBSCRIPTION_SPED_PROCESSADO não configurado — consumer inativo');
      return;
    }
    this.subscription = this.client.subscription(this.subscriptionName);
    this.subscription.on('message', (msg: Message) => this.handleMessage(msg));
    this.subscription.on('error', (err) => this.logger.error(`Pub/Sub error: ${err}`));
    this.logger.log(`Consumer sped_processado escutando em ${this.subscriptionName}`);
  }

  private async handleMessage(msg: Message): Promise<void> {
    let payload: SpedProcessadoPayload;
    try {
      payload = JSON.parse(msg.data.toString()) as SpedProcessadoPayload;
      if (payload.evento !== 'sped_processado') {
        msg.ack();
        return;
      }
    } catch (err) {
      this.logger.error(`Payload inválido: ${err}`);
      msg.nack();
      return;
    }

    try {
      await this.spedService.registrarArquivo(payload);
      msg.ack();
    } catch (err) {
      this.logger.error(`Falha ao registrar arquivo: ${err}`);
      msg.nack();
    }
  }

  async onModuleDestroy() {
    await this.subscription?.close();
    await this.client.close();
  }
}
