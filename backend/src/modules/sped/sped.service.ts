import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { SpedStatus } from '@prisma/client';

export interface SpedArquivoDisponivelEvent {
  tenantId: string;
  cnpj: string;
  tipo: string;
  gcsUri: string;
}

export interface SpedProcessadoPayload {
  evento: string;
  cnpj: string;
  tenantId: string;
  tipo: string;
  gcsBucket: string;
  gcsPath: string;
  nomeArquivo: string;
  dataDocumento: string; // ISO date string
  status: 'disponivel' | 'erro' | 'indisponivel';
  mensagemErro?: string | null;
  timestamp: string;
}

@Injectable()
export class SpedService {
  private readonly logger = new Logger(SpedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async registrarArquivo(payload: SpedProcessadoPayload): Promise<void> {
    const tenantOk = await this.prisma.tenant.findUnique({
      where: { id: payload.tenantId },
      select: { id: true },
    });
    if (!tenantOk) {
      this.logger.warn(`sped_processado: tenantId desconhecido — descartado`);
      return;
    }

    const dataDocumento = new Date(payload.dataDocumento);
    if (Number.isNaN(dataDocumento.getTime())) {
      this.logger.warn(`sped_processado: dataDocumento inválida "${payload.dataDocumento}" — descartado`);
      return;
    }

    const statusMap: Record<string, SpedStatus> = {
      disponivel:   SpedStatus.DISPONIVEL,
      erro:         SpedStatus.ERRO,
      indisponivel: SpedStatus.INDISPONIVEL,
    };

    const status = statusMap[payload.status] ?? SpedStatus.ERRO;

    await this.prisma.spedArquivo.upsert({
      where: {
        tenantId_cnpj_tipo_dataDocumento: {
          tenantId:     payload.tenantId,
          cnpj:         payload.cnpj,
          tipo:         payload.tipo,
          dataDocumento,
        },
      },
      create: {
        tenantId:     payload.tenantId,
        cnpj:         payload.cnpj,
        tipo:         payload.tipo,
        gcsBucket:    payload.gcsBucket,
        gcsPath:      payload.gcsPath,
        nomeArquivo:  payload.nomeArquivo,
        dataDocumento,
        status,
        mensagemErro: payload.mensagemErro ?? null,
      },
      update: {
        gcsBucket:    payload.gcsBucket,
        gcsPath:      payload.gcsPath,
        nomeArquivo:  payload.nomeArquivo,
        status,
        mensagemErro: payload.mensagemErro ?? null,
      },
    });

    this.logger.log(
      `[${payload.cnpj}] ${payload.tipo} ${payload.dataDocumento} → ${payload.status}`,
    );

    if (status === SpedStatus.DISPONIVEL) {
      const event: SpedArquivoDisponivelEvent = {
        tenantId: payload.tenantId,
        cnpj:     payload.cnpj,
        tipo:     payload.tipo,
        gcsUri:   `gs://${payload.gcsBucket}/${payload.gcsPath}`,
      };
      this.eventEmitter.emit('sped.arquivo.disponivel', event);
    }
  }

  async listarPorCnpj(tenantId: string, cnpj: string) {
    return this.prisma.spedArquivo.findMany({
      where: { tenantId, cnpj },
      orderBy: [{ tipo: 'asc' }, { dataDocumento: 'desc' }],
    });
  }
}
