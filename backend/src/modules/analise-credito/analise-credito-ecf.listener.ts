import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { P01Job } from './p01/p01.job';

export interface EcfProcessadoEvent {
  cnpj: string;
}

/**
 * Listener para o evento 'ecf.processado'.
 *
 * Disparado pelo ObrigacaoProcessamentoService (cron a cada 5 min) após um
 * arquivo ECF ser validado com sucesso (GCS + hash + versão = PROCESSADO).
 *
 * Busca os tenants que possuem esse CNPJ em CreditoEmpresa e dispara
 * P01 + encaminha P02→P04 para o worker via Bull queue.
 *
 * Nota: ObrigacaoAcessoria não tem tenantId — por isso a busca em CreditoEmpresa.
 * Se o CNPJ ainda não foi associado a nenhum tenant, nada acontece (P01 cria
 * a entrada de CreditoEmpresa na primeira execução via disparo manual).
 */
@Injectable()
export class AnaliseCreditoEcfListener {
  private readonly logger = new Logger(AnaliseCreditoEcfListener.name);

  constructor(
    private readonly prisma:  PrismaService,
    private readonly p01Job:  P01Job,
  ) {}

  @OnEvent('ecf.processado', { async: true })
  async handleEcfProcessado({ cnpj }: EcfProcessadoEvent): Promise<void> {
    const empresas = await this.prisma.creditoEmpresa.findMany({
      where:  { cnpj },
      select: { tenantId: true },
    });

    if (empresas.length === 0) {
      this.logger.debug(`[EcfListener] CNPJ sem CreditoEmpresa — pipeline não disparado`);
      return;
    }

    // allSettled: dispara todos os tenants em paralelo; falha de um não bloqueia os demais
    const resultados = await Promise.allSettled(
      empresas.map(({ tenantId }) => {
        this.logger.log(`[EcfListener] ECF processado tenant=${tenantId} — disparando pipeline`);
        return this.p01Job.dispararPorCnpj(tenantId, cnpj);
      }),
    );

    for (const [i, resultado] of resultados.entries()) {
      if (resultado.status === 'rejected') {
        const reason = resultado.reason;
        const msg = reason instanceof Error ? reason.message : JSON.stringify(reason);
        this.logger.error(`[EcfListener] Falha tenant=${empresas[i]?.tenantId}: ${msg}`);
      }
    }
  }
}
