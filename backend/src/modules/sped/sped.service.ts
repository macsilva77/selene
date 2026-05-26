import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SpedStatus } from '@prisma/client';

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

  constructor(private readonly prisma: PrismaService) {}

  async registrarArquivo(payload: SpedProcessadoPayload): Promise<void> {
    const statusMap: Record<string, SpedStatus> = {
      disponivel:   SpedStatus.DISPONIVEL,
      erro:         SpedStatus.ERRO,
      indisponivel: SpedStatus.INDISPONIVEL,
    };

    const status = statusMap[payload.status] ?? SpedStatus.ERRO;
    const dataDocumento = new Date(payload.dataDocumento);

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
  }

  async listarPorCnpj(tenantId: string, cnpj: string) {
    return this.prisma.spedArquivo.findMany({
      where: { tenantId, cnpj },
      orderBy: [{ tipo: 'asc' }, { dataDocumento: 'desc' }],
    });
  }
}
