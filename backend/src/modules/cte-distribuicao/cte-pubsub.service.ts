import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PubSub, Topic } from '@google-cloud/pubsub';
import { randomUUID } from 'node:crypto';

// ── Payloads de evento ────────────────────────────────────────────────────────

export interface CteEventoBase {
  eventId: string;
  tenantId: string;
  cnpj: string;
  timestamp: string;
}

export interface CteRecebidoPayload extends CteEventoBase {
  documentoId: string;
  nsu: string;
  tipoDocumento: string;
  modelo?: number | null;
  chaveAcesso?: string;
}

export interface CteEventoEnviadoPayload extends CteEventoBase {
  documentoId: string;
  chaveAcesso: string;
  tpEvento: string;
}

/**
 * Serviço de publicação de eventos do CT-e via Google Cloud Pub/Sub.
 *
 * Desabilitado graciosamente quando os tópicos não estão configurados
 * (ambiente local). Publicações falhas são logadas mas não propagam erro
 * para não impactar o processamento principal dos workers.
 *
 * Tópicos esperados (variáveis de ambiente):
 *   PUBSUB_TOPIC_CTE_RECEBIDO → emitido ao receber e persistir qualquer DF-e do CT-e
 *   PUBSUB_TOPIC_CTE_EVENTO   → emitido após um evento do tomador (ex: desacordo) ser enviado
 */
@Injectable()
export class CtePubSubService implements OnModuleDestroy {
  private readonly logger = new Logger(CtePubSubService.name);
  private readonly client?: PubSub;
  private readonly topics: Record<string, Topic | undefined> = {};

  constructor(private readonly config: ConfigService) {
    const projectId = this.config.get<string>('pubsub.projectId') || this.config.get<string>('PUBSUB_PROJECT_ID');
    const topicCteRecebido = this.config.get<string>('PUBSUB_TOPIC_CTE_RECEBIDO');
    const topicCteEvento = this.config.get<string>('PUBSUB_TOPIC_CTE_EVENTO');

    const algumTopicConfigurado = !!(topicCteRecebido || topicCteEvento);

    if (!algumTopicConfigurado) {
      this.logger.warn('Pub/Sub (CT-e) desabilitado — configure PUBSUB_TOPIC_CTE_* para habilitar');
      return;
    }

    this.client = new PubSub({ projectId: projectId || undefined });

    if (topicCteRecebido) this.topics['cte-recebido'] = this.client.topic(topicCteRecebido);
    if (topicCteEvento) this.topics['cte-evento-enviado'] = this.client.topic(topicCteEvento);

    this.logger.log(`Pub/Sub (CT-e) habilitado — tópicos: ${Object.keys(this.topics).join(', ')}`);
  }

  async onModuleDestroy() {
    if (this.client) await this.client.close();
  }

  // ── Publicadores por tipo de evento ──────────────────────────────────────────

  async publicarCteRecebido(payload: Omit<CteRecebidoPayload, 'eventId' | 'timestamp'>): Promise<void> {
    await this.publicar('cte-recebido', payload);
  }

  async publicarEventoEnviado(payload: Omit<CteEventoEnviadoPayload, 'eventId' | 'timestamp'>): Promise<void> {
    await this.publicar('cte-evento-enviado', payload);
  }

  // ── Publicação genérica ───────────────────────────────────────────────────────

  private async publicar(tipo: string, dados: object): Promise<void> {
    const topic = this.topics[tipo];
    if (!topic) return; // tópico não configurado — silencioso

    const evento = {
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      ...dados,
    } as CteEventoBase & Record<string, unknown>;

    try {
      const messageId = await topic.publishMessage({
        json: evento,
        attributes: { tipo, tenantId: (evento as any).tenantId ?? '' },
      });
      this.logger.debug(`[pubsub] ${tipo} publicado — messageId=${messageId}`);
    } catch (err) {
      // Não propaga — Pub/Sub é best-effort; processamento do worker não deve falhar
      this.logger.warn(`[pubsub] Falha ao publicar ${tipo}: ${(err as Error).message}`);
    }
  }
}
