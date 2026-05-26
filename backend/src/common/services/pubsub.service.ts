import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PubSub } from '@google-cloud/pubsub';

@Injectable()
export class PubSubService implements OnModuleDestroy {
  private readonly logger = new Logger(PubSubService.name);
  private readonly client: PubSub;
  private readonly projectId: string;

  constructor(private readonly config: ConfigService) {
    this.projectId = this.config.get<string>('pubsub.projectId') ?? '';
    this.client = new PubSub({ projectId: this.projectId });
  }

  async publish(topicName: string, payload: Record<string, unknown>): Promise<void> {
    if (!topicName) {
      this.logger.warn(`publish ignorado — tópico não configurado`);
      return;
    }
    try {
      const data = Buffer.from(JSON.stringify(payload));
      await this.client.topic(topicName).publishMessage({ data });
      this.logger.debug(`Evento publicado em ${topicName}`);
    } catch (err) {
      this.logger.error(`Falha ao publicar em ${topicName}: ${err}`);
      throw err;
    }
  }

  async onModuleDestroy() {
    await this.client.close();
  }
}
