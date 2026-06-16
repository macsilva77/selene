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
    let raw: unknown;
    try {
      raw = JSON.parse(msg.data.toString());
    } catch {
      this.logger.warn('Pub/Sub: payload não é JSON — descartado');
      msg.ack();
      return;
    }

    const payload = validarPayload(raw);
    if (!payload) {
      this.logger.warn('Pub/Sub: payload inválido ou evento desconhecido — descartado');
      msg.ack();
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

// ─── Validação de payload externo ────────────────────────────────────────────

const VALID_STATUS = new Set(['disponivel', 'erro', 'indisponivel']);

function validarPayload(raw: unknown): SpedProcessadoPayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (p['evento'] !== 'sped_processado') return null;
  if (!p['tenantId']  || typeof p['tenantId']  !== 'string') return null;
  if (!p['cnpj']      || typeof p['cnpj']      !== 'string') return null;
  if (!p['tipo']      || typeof p['tipo']       !== 'string') return null;
  if (!p['gcsBucket'] || typeof p['gcsBucket']  !== 'string') return null;
  if (!p['gcsPath']   || typeof p['gcsPath']    !== 'string') return null;
  const datadoc = p['dataDocumento'];
  if (typeof datadoc !== 'string' || Number.isNaN(Date.parse(datadoc))) return null;
  const status = p['status'];
  if (typeof status !== 'string' || !VALID_STATUS.has(status)) return null;
  return p as unknown as SpedProcessadoPayload;
}
