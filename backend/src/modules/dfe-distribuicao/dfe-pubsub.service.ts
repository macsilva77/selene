import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PubSub, Topic } from '@google-cloud/pubsub';
import { randomUUID } from 'node:crypto';

// ── Payloads de evento ────────────────────────────────────────────────────────

export interface DfeEventoBase {
  eventId: string;
  tenantId: string;
  cnpj: string;
  timestamp: string;
}

export interface DfeNfeRecebidaPayload extends DfeEventoBase {
  documentoId: string;
  nsu: string;
  tipoDocumento: string;
  chaveAcesso?: string;
}

export interface DfeCienciaEnviadaPayload extends DfeEventoBase {
  documentoId: string;
  chaveAcesso: string;
}

export interface DfeNfeBaixadaPayload extends DfeEventoBase {
  documentoId: string;
  chaveAcesso: string;
  nsu: string;
}

/**
 * Serviço de publicação de eventos DFe via Google Cloud Pub/Sub.
 *
 * Desabilitado graciosamente quando os tópicos não estão configurados
 * (ambiente local). Publicações falhas são logadas mas não propagam erro
 * para não impactar o processamento principal dos workers.
 *
 * Tópicos esperados (variáveis de ambiente):
 *   PUBSUB_TOPIC_NFE_RECEBIDA    → emitido ao receber e persistir qualquer DF-e
 *   PUBSUB_TOPIC_CIENCIA_ENVIADA → emitido após Ciência da Operação confirmada
 *   PUBSUB_TOPIC_NFE_BAIXADA     → emitido após download do procNFe concluído
 *
 * Dead letter: configure via gcloud/Terraform na subscription — a aplicação
 * não precisa de código adicional para dead letter no lado publisher.
 *
 *   gcloud pubsub subscriptions modify-push-config <sub> \
 *     --dead-letter-topic=dfe-dead-letter \
 *     --max-delivery-attempts=5
 */
@Injectable()
export class DfePubSubService implements OnModuleDestroy {
  private readonly logger = new Logger(DfePubSubService.name);
  private readonly client?: PubSub;
  private readonly topics: Record<string, Topic | undefined> = {};

  constructor(private readonly config: ConfigService) {
    const projectId = this.config.get<string>('pubsub.projectId');
    const topicNfeRecebida    = this.config.get<string>('pubsub.topicNfeRecebida');
    const topicCienciaEnviada = this.config.get<string>('pubsub.topicCienciaEnviada');
    const topicNfeBaixada     = this.config.get<string>('pubsub.topicNfeBaixada');

    const algumTopicConfigurado = !!(topicNfeRecebida || topicCienciaEnviada || topicNfeBaixada);

    if (!algumTopicConfigurado) {
      this.logger.warn('Pub/Sub desabilitado — configure PUBSUB_TOPIC_* para habilitar');
      return;
    }

    this.client = new PubSub({ projectId: projectId || undefined });

    if (topicNfeRecebida)    this.topics['nfe-recebida']    = this.client.topic(topicNfeRecebida);
    if (topicCienciaEnviada) this.topics['ciencia-enviada'] = this.client.topic(topicCienciaEnviada);
    if (topicNfeBaixada)     this.topics['nfe-baixada']     = this.client.topic(topicNfeBaixada);

    this.logger.log(`Pub/Sub habilitado — tópicos: ${Object.keys(this.topics).join(', ')}`);
  }

  async onModuleDestroy() {
    if (this.client) await this.client.close();
  }

  // ── Publicadores por tipo de evento ──────────────────────────────────────────

  async publicarNfeRecebida(payload: Omit<DfeNfeRecebidaPayload, 'eventId' | 'timestamp'>): Promise<void> {
    await this.publicar('nfe-recebida', payload);
  }

  async publicarCienciaEnviada(payload: Omit<DfeCienciaEnviadaPayload, 'eventId' | 'timestamp'>): Promise<void> {
    await this.publicar('ciencia-enviada', payload);
  }

  async publicarNfeBaixada(payload: Omit<DfeNfeBaixadaPayload, 'eventId' | 'timestamp'>): Promise<void> {
    await this.publicar('nfe-baixada', payload);
  }

  // ── Publicação genérica ───────────────────────────────────────────────────────

  private async publicar(tipo: string, dados: object): Promise<void> {
    const topic = this.topics[tipo];
    if (!topic) return; // tópico não configurado — silencioso

    const evento = {
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      ...dados,
    } as DfeEventoBase & Record<string, unknown>;

    try {
      const messageId = await topic.publishMessage({
        json: evento,
        attributes: { tipo, tenantId: (evento as any).tenantId ?? '' },
      });
      this.logger.debug(`[pubsub] ${tipo} publicado — messageId=${messageId}`);
    } catch (err) {
      // Não propaga — Pub/Sub é best-effort; processsamento do worker não deve falhar
      this.logger.warn(`[pubsub] Falha ao publicar ${tipo}: ${(err as Error).message}`);
    }
  }
}
