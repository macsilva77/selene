import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService }                   from '../../database/prisma.service';
import { P01Service }                      from './p01/p01.service';
import { AnaliseCreditoCalcularService }   from './analise-credito-calcular.service';

export interface EcfProcessadoEvent {
  cnpj: string;
}

/**
 * Listener para o evento 'ecf.processado'.
 * Disparado pelo ObrigacaoProcessamentoService após um arquivo ECF ser validado.
 *
 * Fluxo automático:
 *  1. Busca tenantId na tabela Empresa (não CreditoEmpresa, que só existe após P01).
 *  2. Executa P01 (ECF → Parquet) — cria/atualiza CreditoEmpresa.
 *  3. Executa calcular (P02→P03→P04) — calcula indicadores, alertas e classificação.
 */
@Injectable()
export class AnaliseCreditoEcfListener {
  private readonly logger = new Logger(AnaliseCreditoEcfListener.name);

  constructor(
    private readonly prisma:           PrismaService,
    private readonly p01Service:       P01Service,
    private readonly calcularService:  AnaliseCreditoCalcularService,
  ) {}

  @OnEvent('ecf.processado', { async: true })
  async handleEcfProcessado({ cnpj }: EcfProcessadoEvent): Promise<void> {
    // Usa Empresa (não CreditoEmpresa) para que empresas novas — ainda sem P01 — sejam processadas.
    const empresas = await this.prisma.empresa.findMany({
      where:  { cnpj },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });

    if (empresas.length === 0) {
      this.logger.warn(`[EcfListener] CNPJ ${cnpj} não encontrado em nenhum tenant — P01 não disparado`);
      return;
    }

    for (const { tenantId } of empresas) {
      try {
        this.logger.log(`[EcfListener] ECF processado tenant=${tenantId} cnpj=${cnpj} — iniciando P01`);
        await this.p01Service.processarCnpj(tenantId, cnpj);
      } catch (err) {
        const msg = err instanceof Error ? err.message : JSON.stringify(err);
        this.logger.error(`[EcfListener] Falha P01 tenant=${tenantId} cnpj=${cnpj}: ${msg}`);
        continue;
      }

      // Após P01, CreditoEmpresa já existe → calcular indicadores + alertas automaticamente.
      try {
        const empresa = await this.prisma.creditoEmpresa.findUnique({
          where:  { tenantId_cnpj: { tenantId, cnpj } },
          select: { id: true, cnpj: true, regimeTributario: true },
        });
        if (!empresa) {
          this.logger.warn(`[EcfListener] CreditoEmpresa não criada após P01 tenant=${tenantId} cnpj=${cnpj}`);
          continue;
        }

        this.logger.log(`[EcfListener] Iniciando calcular tenant=${tenantId} cnpj=${cnpj}`);
        await this.calcularService.calcularParaEmpresa(empresa);
      } catch (err) {
        const msg = err instanceof Error ? err.message : JSON.stringify(err);
        this.logger.error(`[EcfListener] Falha calcular tenant=${tenantId} cnpj=${cnpj}: ${msg}`);
      }
    }
  }
}
