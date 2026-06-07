import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { P01Service }    from './p01/p01.service';

export interface EcfProcessadoEvent {
  cnpj: string;
}

/**
 * Listener para o evento 'ecf.processado'.
 * Disparado pelo ObrigacaoProcessamentoService após um arquivo ECF ser validado.
 * Executa P01 (ECF → Parquet) para todos os tenants que possuem esse CNPJ.
 * O cálculo de indicadores é feito pelo usuário via botão "Processar".
 */
@Injectable()
export class AnaliseCreditoEcfListener {
  private readonly logger = new Logger(AnaliseCreditoEcfListener.name);

  constructor(
    private readonly prisma:      PrismaService,
    private readonly p01Service:  P01Service,
  ) {}

  @OnEvent('ecf.processado', { async: true })
  async handleEcfProcessado({ cnpj }: EcfProcessadoEvent): Promise<void> {
    const empresas = await this.prisma.creditoEmpresa.findMany({
      where:  { cnpj },
      select: { tenantId: true },
    });

    if (empresas.length === 0) {
      this.logger.debug(`[EcfListener] CNPJ sem CreditoEmpresa — P01 não disparado`);
      return;
    }

    const resultados = await Promise.allSettled(
      empresas.map(({ tenantId }) => {
        this.logger.log(`[EcfListener] ECF processado tenant=${tenantId} cnpj=${cnpj} — iniciando P01`);
        return this.p01Service.processarCnpj(tenantId, cnpj);
      }),
    );

    for (const [i, resultado] of resultados.entries()) {
      if (resultado.status === 'rejected') {
        const msg = resultado.reason instanceof Error ? resultado.reason.message : JSON.stringify(resultado.reason);
        this.logger.error(`[EcfListener] Falha P01 tenant=${empresas[i]?.tenantId}: ${msg}`);
      }
    }
  }
}
