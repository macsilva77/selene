import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DfeVarreduraStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { DfeCertLoaderService } from './dfe-cert-loader.service';
import { DfeSoapClientService } from './dfe-soap-client.service';
import { DfeXmlProcessorService } from './dfe-xml-processor.service';
import { DfeNsuRedisRepository } from './dfe-nsu-redis.repository';
import { CSTAT } from './dfe.types';

/** Quantidade de NSUs processados por ciclo de cron (por varredura ativa). */
const LOTE_POR_CICLO = 30;

/** Delay entre chamadas consNSU dentro de um lote (ms) — respeita rate-limit SEFAZ. */
const DELAY_ENTRE_NSU_MS = 200;

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/**
 * Serviço de varredura retroativa de NSU via consNSU.
 *
 * Problema: O NFeDistribuicaoDFe (distNSU) só distribui documentos enfileirados
 * a partir da primeira chamada do CNPJ. Documentos emitidos ANTES não entram na
 * fila de distribuição.
 *
 * Solução: O consNSU consulta um NSU específico no Ambiente Nacional e retorna
 * o documento SE o CNPJ for o interessado (destinatário, transportador etc.),
 * independente da fila de distribuição. Iterando o intervalo de NSUs dos últimos
 * 90 dias é possível recuperar esses documentos históricos.
 *
 * Uso:
 *  1. Descubra o NSU aproximado de 90 dias atrás (veja `estimarNsuInicio`).
 *  2. Chame `iniciarVarredura(tenantId, configId, nsuInicio, nsuFim)`.
 *  3. O job `DfeVarreduraJob` processa automaticamente a cada minuto.
 *  4. Chame `pausarVarredura` / `retomar` conforme necessário.
 */
@Injectable()
export class DfeVarreduraService {
  private readonly logger = new Logger(DfeVarreduraService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly certLoader: DfeCertLoaderService,
    private readonly soapClient: DfeSoapClientService,
    private readonly xmlProcessor: DfeXmlProcessorService,
    private readonly nsuRepo: DfeNsuRedisRepository,
  ) {}

  // ────────────────────────────────────────────────────────────────────────────
  // API pública — controle da varredura
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Inicia (ou reinicia) uma varredura retroativa para o configId informado.
   * Se já existir uma varredura CONCLUIDA ou ERRO, cria uma nova do zero.
   * Se existir uma PAUSADA, retoma do ponto atual ou do nsuInicio informado.
   */
  async iniciarVarredura(
    tenantId: string,
    configId: string,
    nsuInicio: string,
    nsuFim: string,
  ): Promise<void> {
    await this.assertConfig(configId, tenantId);

    const nsuInicioP = nsuInicio.padStart(15, '0');
    const nsuFimP = nsuFim.padStart(15, '0');

    if (BigInt(nsuInicioP) >= BigInt(nsuFimP)) {
      throw new BadRequestException('nsuInicio deve ser menor que nsuFim.');
    }

    await this.prisma.dfeVarreduraNsu.upsert({
      where: { configId },
      create: {
        configId,
        tenantId,
        cnpj: await this.getCnpj(configId),
        status: DfeVarreduraStatus.ATIVA,
        nsuInicio: nsuInicioP,
        nsuFim: nsuFimP,
        nsuAtual: nsuInicioP,
        totalConsultado: 0,
        totalRecuperado: 0,
        iniciadoEm: new Date(),
      },
      update: {
        status: DfeVarreduraStatus.ATIVA,
        nsuInicio: nsuInicioP,
        nsuFim: nsuFimP,
        nsuAtual: nsuInicioP,
        totalConsultado: 0,
        totalRecuperado: 0,
        iniciadoEm: new Date(),
        pausadoEm: null,
        concluidoEm: null,
        ultimoErro: null,
      },
    });

    this.logger.log(
      `Varredura iniciada: configId=${configId} range=[${nsuInicioP}, ${nsuFimP}]`,
    );
  }

  /** Pausa uma varredura ATIVA. */
  async pausarVarredura(tenantId: string, configId: string): Promise<void> {
    const varredura = await this.prisma.dfeVarreduraNsu.findUnique({
      where: { configId },
    });

    if (!varredura || varredura.tenantId !== tenantId) {
      throw new NotFoundException('Varredura não encontrada para esta configuração.');
    }

    if (varredura.status !== DfeVarreduraStatus.ATIVA) {
      throw new BadRequestException(`Varredura não está ativa (status=${varredura.status}).`);
    }

    await this.prisma.dfeVarreduraNsu.update({
      where: { configId },
      data: { status: DfeVarreduraStatus.PAUSADA, pausadoEm: new Date() },
    });

    this.logger.log(`Varredura pausada: configId=${configId} nsuAtual=${varredura.nsuAtual}`);
  }

  /** Retoma uma varredura PAUSADA. */
  async retomarVarredura(tenantId: string, configId: string): Promise<void> {
    const varredura = await this.prisma.dfeVarreduraNsu.findUnique({
      where: { configId },
    });

    if (!varredura || varredura.tenantId !== tenantId) {
      throw new NotFoundException('Varredura não encontrada para esta configuração.');
    }

    if (varredura.status !== DfeVarreduraStatus.PAUSADA) {
      throw new BadRequestException(`Varredura não está pausada (status=${varredura.status}).`);
    }

    await this.prisma.dfeVarreduraNsu.update({
      where: { configId },
      data: { status: DfeVarreduraStatus.ATIVA, pausadoEm: null },
    });

    this.logger.log(`Varredura retomada: configId=${configId} continuando de nsuAtual=${varredura.nsuAtual}`);
  }

  /** Retorna o status atual da varredura para a configuração. */
  async getStatus(tenantId: string, configId: string) {
    await this.assertConfig(configId, tenantId);

    const v = await this.prisma.dfeVarreduraNsu.findUnique({ where: { configId } });

    if (!v) return null;

    const total = BigInt(v.nsuFim) - BigInt(v.nsuInicio);
    const feito = BigInt(v.nsuAtual) - BigInt(v.nsuInicio);
    const restante = total - feito;
    const pct = total > 0n ? Number((feito * 10000n) / total) / 100 : 0;

    // Estimativa de conclusão com base na taxa atual (30 NSUs/min)
    const minutosRestantes = Number(restante) / LOTE_POR_CICLO;
    const estimativaConclusao = v.status === DfeVarreduraStatus.ATIVA
      ? new Date(Date.now() + minutosRestantes * 60_000)
      : null;

    return {
      status: v.status,
      nsuInicio: v.nsuInicio,
      nsuFim: v.nsuFim,
      nsuAtual: v.nsuAtual,
      totalConsultado: v.totalConsultado,
      totalRecuperado: v.totalRecuperado,
      percentual: pct,
      estimativaConclusao,
      iniciadoEm: v.iniciadoEm,
      pausadoEm: v.pausadoEm,
      concluidoEm: v.concluidoEm,
      ultimoErro: v.ultimoErro,
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Processamento — chamado pelo job
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Processa o próximo lote de NSUs para uma varredura específica (configId).
   * Chamado pelo DfeVarreduraWorker — substitui processarLotesAtivos() no novo fluxo.
   */
  async executarLote(configId: string): Promise<void> {
    const varredura = await this.prisma.dfeVarreduraNsu.findUnique({
      where: { configId },
      include: {
        config: {
          select: { id: true, tenantId: true, cnpj: true, cUf: true, tpAmb: true, ativo: true },
        },
      },
    });

    if (!varredura || varredura.status !== DfeVarreduraStatus.ATIVA || !varredura.config.ativo) return;

    await this.processarLote(varredura);
  }

  /**
   * Processa o próximo lote de NSUs para todas as varreduras ATIVAS.
   * @deprecated Usar executarLote(configId) via DfeVarreduraWorker.
   */
  async processarLotesAtivos(): Promise<void> {
    const ativas = await this.prisma.dfeVarreduraNsu.findMany({
      where: { status: DfeVarreduraStatus.ATIVA },
      include: {
        config: {
          select: { id: true, tenantId: true, cnpj: true, cUf: true, tpAmb: true, ativo: true },
        },
      },
    });

    if (ativas.length === 0) return;

    this.logger.debug(`Varredura: ${ativas.length} varredura(s) ativa(s).`);

    for (const varredura of ativas) {
      if (!varredura.config.ativo) continue;
      await this.processarLote(varredura);
    }
  }

  private async processarLote(
    varredura: {
      id: string;
      configId: string;
      tenantId: string;
      cnpj: string;
      nsuAtual: string;
      nsuFim: string;
      totalConsultado: number;
      totalRecuperado: number;
      config: { id: string; tenantId: string; cnpj: string; cUf: number; tpAmb: number; ativo: boolean };
    },
  ): Promise<void> {
    const { config } = varredura;
    let pemCert: string;
    let pemKey: string;

    try {
      const cert = await this.certLoader.loadCert(config.tenantId, config.id);
      pemCert = cert.pemCert;
      pemKey = cert.pemKey;
    } catch (err) {
      this.logger.error(`Varredura configId=${varredura.configId}: falha ao carregar cert — ${(err as Error).message}`);
      await this.prisma.dfeVarreduraNsu.update({
        where: { configId: varredura.configId },
        data: { status: DfeVarreduraStatus.ERRO, ultimoErro: (err as Error).message },
      });
      return;
    }

    let nsuAtualBigInt = BigInt(varredura.nsuAtual);
    const nsuFimBigInt = BigInt(varredura.nsuFim);
    let consultados = 0;
    let recuperados = 0;

    // Obtém controleId para criar lotes de rastreamento
    const controle = await this.prisma.dfeNsuControle.findUnique({
      where: { configId: varredura.configId },
      select: { id: true },
    });

    for (let i = 0; i < LOTE_POR_CICLO && nsuAtualBigInt <= nsuFimBigInt; i++) {
      const nsuPadded = String(nsuAtualBigInt).padStart(15, '0');

      try {
        const ret = await this.soapClient.consultarNSU(
          {
            cnpj: config.cnpj,
            cUf: config.cUf,
            tpAmb: config.tpAmb as 1 | 2,
            nsu: nsuPadded,
          },
          pemCert,
          pemKey,
        );

        const cStat = String(ret.cStat);

        if (cStat === String(CSTAT.CONSUMO_INDEVIDO)) {
          this.logger.warn(
            `Varredura configId=${varredura.configId}: cStat=656 (Consumo Indevido) no NSU=${nsuPadded} — pausando varredura por 1h.`,
          );
          await this.prisma.dfeVarreduraNsu.update({
            where: { configId: varredura.configId },
            data: {
              status: DfeVarreduraStatus.PAUSADA,
              pausadoEm: new Date(),
              ultimoErro: `Consumo Indevido (656) no NSU ${nsuPadded} — aguardar 1h antes de retomar`,
            },
          });
          // Aplica cooldown de 1h no controle principal para que o distNSU também pare
          if (controle) {
            await this.nsuRepo.agendarProximaConsulta(
              controle.id,
              new Date(Date.now() + 60 * 60_000),
            );
          }
          return;
        }

        if (cStat === String(CSTAT.DOCUMENTOS_LOCALIZADOS) && ret.documentos?.length && controle) {
          // Cria lote de rastreamento
          const lote = await this.prisma.dfeLote.create({
            data: {
              controleId: controle.id,
              tenantId: varredura.tenantId,
              cnpj: config.cnpj,
              nsuEnviado: nsuPadded,
              cStat: String(CSTAT.DOCUMENTOS_LOCALIZADOS),
              xMotivo: 'Varredura retroativa NSU',
              ultNsuRecebido: nsuPadded,
              maxNsuRecebido: ret.maxNSU ?? nsuPadded,
              qtdDocumentos: ret.documentos.length,
            },
          });

          for (const docRaw of ret.documentos) {
            await this.xmlProcessor.processarDocumento(
              docRaw,
              lote.id,
              varredura.tenantId,
              config.cnpj,
            );
          }

          recuperados++;
          this.logger.log(
            `Varredura configId=${varredura.configId}: NSU=${nsuPadded} → documento recuperado`,
          );
        }
        // cStat=137 → NSU inexistente/não relevante — apenas avança
      } catch (err) {
        this.logger.warn(
          `Varredura configId=${varredura.configId}: erro no NSU=${nsuPadded} — ${(err as Error).message}`,
        );
        // Erro pontual não para a varredura — apenas loga e avança
      }

      consultados++;
      nsuAtualBigInt++;

      // Delay entre chamadas para respeitar rate-limit SEFAZ
      if (i < LOTE_POR_CICLO - 1 && nsuAtualBigInt <= nsuFimBigInt) {
        await sleep(DELAY_ENTRE_NSU_MS);
      }
    }

    const novoNsuAtual = String(nsuAtualBigInt).padStart(15, '0');
    const concluida = nsuAtualBigInt > nsuFimBigInt;

    await this.prisma.dfeVarreduraNsu.update({
      where: { configId: varredura.configId },
      data: {
        nsuAtual: novoNsuAtual,
        totalConsultado: { increment: consultados },
        totalRecuperado: { increment: recuperados },
        ...(concluida
          ? { status: DfeVarreduraStatus.CONCLUIDA, concluidoEm: new Date() }
          : {}),
      },
    });

    if (concluida) {
      this.logger.log(
        `Varredura CONCLUÍDA: configId=${varredura.configId} total=${varredura.totalConsultado + consultados} recuperados=${varredura.totalRecuperado + recuperados}`,
      );
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────────

  private async assertConfig(configId: string, tenantId: string) {
    const config = await this.prisma.dfeConfig.findFirst({
      where: { id: configId, tenantId },
    });
    if (!config) throw new NotFoundException('Configuração DFe não encontrada.');
    return config;
  }

  private async getCnpj(configId: string): Promise<string> {
    const config = await this.prisma.dfeConfig.findUniqueOrThrow({ where: { id: configId } });
    return config.cnpj;
  }
}
