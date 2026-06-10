import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PubSub, Message } from '@google-cloud/pubsub';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProcessarSpedDto } from './dto/processar-sped.dto';
import { ClientesFornecedoresProcessamentoService } from './clientes-fornecedores-processamento.service';

const EVENTO_ESPERADO = 'cf_sped_efd_disponivel';

@Injectable()
export class ClientesFornecedoresPubSubConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClientesFornecedoresPubSubConsumer.name);
  private readonly client: PubSub;
  private readonly subscriptionName: string;
  private subscription: ReturnType<PubSub['subscription']> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly processamento: ClientesFornecedoresProcessamentoService,
  ) {
    const projectId = this.config.get<string>('pubsub.projectId') ?? '';
    this.client = new PubSub({ projectId });
    this.subscriptionName =
      this.config.get<string>('pubsub.subscriptionClientesFornecedores') ?? '';
  }

  onModuleInit(): void {
    if (!this.subscriptionName) {
      this.logger.warn(
        'PUBSUB_SUBSCRIPTION_CLIENTES_FORNECEDORES não configurado — consumer inativo',
      );
      return;
    }
    this.subscription = this.client.subscription(this.subscriptionName);
    this.subscription.on('message', (msg: Message) => void this.handleMessage(msg));
    this.subscription.on('error', (err) =>
      this.logger.error(`Pub/Sub error: ${String(err)}`),
    );
    this.logger.log(
      `Consumer clientes-fornecedores escutando em ${this.subscriptionName}`,
    );
  }

  private async handleMessage(msg: Message): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(msg.data.toString()) as unknown;
    } catch {
      this.logger.error('Payload inválido — JSON parse error');
      msg.ack(); // ack para não travar retry loop em mensagem malformada
      return;
    }

    const dto    = plainToInstance(ProcessarSpedDto, raw);
    const errors = await validate(dto);
    if (errors.length > 0) {
      this.logger.error(
        `Payload inválido: ${errors.map((e) => e.toString()).join('; ')}`,
      );
      msg.ack(); // erros de validação não são recuperáveis
      return;
    }

    if (dto.evento !== EVENTO_ESPERADO) {
      msg.ack(); // evento de outro tópico roteado aqui — ignorar
      return;
    }

    try {
      await this.processamento.processar({
        tenantId:            dto.tenantId,
        empresaId:           dto.empresaId,
        cnpj:                dto.cnpj,
        ano:                 dto.ano,
        mes:                 dto.mes,
        spedIcmsIpiGcsUri:   dto.spedIcmsIpiGcsUri,
        spedContribGcsUri:   dto.spedContribGcsUri,
      });
      msg.ack();
    } catch (err) {
      this.logger.error(`Falha no processamento: ${String(err)}`);
      msg.nack(); // falha de infra — Pub/Sub fará retry com backoff
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscription?.close();
    await this.client.close();
  }
}
