import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditAcao, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { CteCertLoaderService } from './cte-cert-loader.service';
import { CteSoapClientService } from './cte-soap-client.service';
import { CteNsuControlRepository } from './cte-nsu-control.repository';
import { CteNsuRedisRepository } from './cte-nsu-redis.repository';
import { CteStorageService } from './cte-storage.service';
import { CteXmlProcessorService } from './cte-xml-processor.service';
import { CteGapDetectorService } from './cte-gap-detector.service';
import { ConfigurarCteDto } from './dto/configurar-cte.dto';
import {
  CSTAT,
  CTE_WORKER_DEFAULTS,
  CteCicloResultado,
  HORARIO_MIN_RECHECK_MS,
} from './cte.types';
import { buildMeta, parsePagination } from '../../common/utils/pagination.helper';

/** Mapa de sigla UF → código IBGE */
const UF_PARA_CUF: Record<string, number> = {
  AC: 12, AL: 27, AP: 16, AM: 13, BA: 29, CE: 23,
  DF: 53, ES: 32, GO: 52, MA: 21, MT: 51, MS: 50,
  MG: 31, PA: 15, PB: 25, PR: 41, PE: 26, PI: 22,
  RJ: 33, RN: 24, RS: 43, RO: 11, RR: 14, SC: 42,
  SP: 35, SE: 28, TO: 17,
};

export interface ListarCteDocumentosQuery {
  page?: string | number;
  limit?: string | number;
  cnpj?: string;
  tipo?: string;
  modelo?: string | number;
  chaveAcesso?: string;
  cteEmitenteCnpj?: string;
  cteTomadorCnpj?: string;
  dataInicio?: string;
  dataFim?: string;
  valorMin?: string | number;
  valorMax?: string | number;
}

/**
 * Orquestra a distribuição DF-e do CT-e:
 *  - Configuração (CteConfig + CteNsuControle)
 *  - Ciclo de distribuição (SOAP → lote → documentos em pool paralelo → NSU update)
 *  - Status / listagens
 */
@Injectable()
export class CteDistribuicaoService {
  private readonly logger = new Logger(CteDistribuicaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly certLoader: CteCertLoaderService,
    private readonly soapClient: CteSoapClientService,
    private readonly nsuRepo: CteNsuControlRepository,
    private readonly nsuRedisRepo: CteNsuRedisRepository,
    private readonly xmlProcessor: CteXmlProcessorService,
    private readonly gapDetector: CteGapDetectorService,
    private readonly auditoria: AuditoriaService,
    private readonly storageService: CteStorageService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────────
  // Configuração
  // ────────────────────────────────────────────────────────────────────────────

  async configurarCte(tenantId: string, usuarioId: string, dto: ConfigurarCteDto) {
    const cUf = UF_PARA_CUF[dto.uf.toUpperCase()];
    if (!cUf) throw new BadRequestException(`UF inválida: ${dto.uf}`);

    const existente = await this.prisma.cteConfig.findUnique({
      where: { tenantId_cnpj: { tenantId, cnpj: dto.cnpj } },
    });
    if (existente) {
      throw new ConflictException(
        `Já existe uma configuração de CT-e para o CNPJ ${dto.cnpj} neste tenant.`,
      );
    }

    const certificado = await this.prisma.certificadoDigital.findFirst({
      where: { id: dto.certificadoId, tenantId },
      select: { id: true },
    });
    if (!certificado) {
      throw new NotFoundException(`Certificado ${dto.certificadoId} não encontrado neste tenant.`);
    }

    // Cria config + controle NSU atomicamente. O scheduler filtra pela relação
    // `controle`; uma config sem controle ficaria invisível à sincronização
    // automática para sempre se a 2ª escrita falhasse.
    const config = await this.prisma.$transaction(async (tx) => {
      const cfg = await tx.cteConfig.create({
        data: {
          tenantId,
          cnpj: dto.cnpj,
          cUf,
          tpAmb: dto.tpAmb ?? 1,
          certificadoId: dto.certificadoId,
          horarioCaptura: dto.horarioCaptura ?? '00:00',
          intervaloMinutos: dto.intervaloMinutos ?? 60,
          criadoPorId: usuarioId,
        },
      });
      await tx.cteNsuControle.create({
        data: {
          configId: cfg.id,
          tenantId,
          cnpj: cfg.cnpj,
          ultimoNsu: '000000000000000',
          maxNsu: '000000000000000',
          emProcessamento: false,
        },
      });
      return cfg;
    });

    this.logger.log(`Configuração CT-e criada: CNPJ=${dto.cnpj} cUf=${cUf} configId=${config.id}`);
    return config;
  }

  async listarStatus(tenantId: string) {
    const configs = await this.prisma.cteConfig.findMany({
      where: { tenantId },
      include: {
        controle: {
          select: {
            ultimoNsu: true,
            maxNsu: true,
            ultimaConsulta: true,
            proximaConsulta: true,
            emProcessamento: true,
            totalDocBaixados: true,
            totalLotes: true,
            totalErros: true,
            errosConsecutivos: true,
            ultimoErro: true,
            ultimoErroEm: true,
            lotes: {
              select: { cStat: true, xMotivo: true, iniciadoEm: true },
              orderBy: { iniciadoEm: 'desc' },
              take: 1,
            },
          },
        },
        certificado: {
          select: { id: true, razaoSocial: true, cnpjCert: true, dataValidade: true, status: true },
        },
      },
      orderBy: { criadoEm: 'asc' },
    });

    // Nomes das empresas pelo CNPJ
    const cnpjs = [...new Set(configs.map((c) => c.cnpj))];
    const empresas = await this.prisma.empresa.findMany({
      where: { tenantId, cnpj: { in: cnpjs } },
      select: { cnpj: true, nome: true, nomeFantasia: true },
    });
    const empresaMap = new Map(empresas.map((e) => [e.cnpj, e]));

    return configs.map((c) => {
      const controle = c.controle
        ? (() => {
            const { lotes, ...rest } = c.controle!;
            return { ...rest, ultimoLote: lotes[0] ?? null };
          })()
        : null;
      const empresa = empresaMap.get(c.cnpj);
      return {
        id: c.id,
        cnpj: c.cnpj,
        nome: empresa?.nome ?? null,
        nomeFantasia: empresa?.nomeFantasia ?? null,
        cUf: c.cUf,
        tpAmb: c.tpAmb,
        ativo: c.ativo,
        horarioCaptura: c.horarioCaptura,
        intervaloMinutos: c.intervaloMinutos,
        certificado: c.certificado,
        controle,
      };
    });
  }

  /** Histórico de lotes (chamadas SEFAZ) — usado no drawer de detalhe da config. */
  async listarLotes(tenantId: string, params: { configId?: string; cnpj?: string; page?: number; limit?: number }) {
    const { page, limit, skip } = parsePagination(params);

    const where: Prisma.CteLoteWhereInput = { tenantId };
    if (params.configId) where.controle = { configId: params.configId };
    if (params.cnpj) where.cnpj = params.cnpj;

    const [total, lotes] = await Promise.all([
      this.prisma.cteLote.count({ where }),
      this.prisma.cteLote.findMany({
        where,
        select: {
          id: true, cnpj: true, nsuEnviado: true, cStat: true, xMotivo: true,
          ultNsuRecebido: true, maxNsuRecebido: true, qtdDocumentos: true,
          status: true, duracaoMs: true, iniciadoEm: true, finalizadoEm: true, erroMensagem: true,
        },
        orderBy: { iniciadoEm: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return { data: lotes, meta: buildMeta(total, page, limit) };
  }

  async toggleConfig(tenantId: string, configId: string) {
    const config = await this.obterConfig(tenantId, configId);
    const atualizado = await this.prisma.cteConfig.update({
      where: { id: config.id },
      data: { ativo: !config.ativo },
    });
    return atualizado;
  }

  async excluirConfig(tenantId: string, configId: string) {
    const config = await this.obterConfig(tenantId, configId);
    const controle = await this.prisma.cteNsuControle.findUnique({
      where: { configId: config.id },
      select: { id: true },
    });

    // Sem cascade no schema — remove dependências em ordem de FK.
    await this.prisma.$transaction(async (tx) => {
      if (controle) {
        const lotes = await tx.cteLote.findMany({ where: { controleId: controle.id }, select: { id: true } });
        const loteIds = lotes.map((l) => l.id);
        if (loteIds.length) {
          const docs = await tx.cteDocumento.findMany({ where: { loteId: { in: loteIds } }, select: { id: true } });
          const docIds = docs.map((d) => d.id);
          if (docIds.length) {
            await tx.cteEvento.deleteMany({ where: { documentoId: { in: docIds } } });
            await tx.cteDocumentoEtiqueta.deleteMany({ where: { documentoId: { in: docIds } } });
            await tx.cteEtiquetaHistorico.deleteMany({ where: { documentoId: { in: docIds } } });
            await tx.cteGapNsu.updateMany({ where: { documentoId: { in: docIds } }, data: { documentoId: null } });
            await tx.cteDocumento.deleteMany({ where: { id: { in: docIds } } });
          }
          await tx.cteLote.deleteMany({ where: { id: { in: loteIds } } });
        }
      }
      await tx.cteVarreduraNsu.deleteMany({ where: { configId: config.id } });
      await tx.cteGapNsu.deleteMany({ where: { configId: config.id } });
      await tx.cteNsuControle.deleteMany({ where: { configId: config.id } });
      await tx.cteConfig.delete({ where: { id: config.id } });
    });
    return { ok: true };
  }

  /** Dispara uma sincronização manual (force) validando a posse do tenant. */
  async dispararSincronizacao(tenantId: string, configId: string) {
    await this.obterConfig(tenantId, configId);
    await this.sincronizarCte(configId, undefined, true);
    return { ok: true };
  }

  private async obterConfig(tenantId: string, configId: string) {
    const config = await this.prisma.cteConfig.findFirst({ where: { id: configId, tenantId } });
    if (!config) throw new NotFoundException(`Configuração CT-e ${configId} não encontrada.`);
    return config;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Sincronização (baixa)
  // ────────────────────────────────────────────────────────────────────────────

  async sincronizarCte(
    configId: string,
    maxCiclos = CTE_WORKER_DEFAULTS.maxCiclosPorExecucao,
    force = false,
  ): Promise<void> {
    const config = await this.prisma.cteConfig.findUnique({ where: { id: configId } });
    if (!config?.ativo) {
      this.logger.warn(`Configuração CT-e ${configId} não encontrada ou inativa — ignorada`);
      return;
    }

    const controle = await this.nsuRepo.obterOuCriarControle(configId, config.tenantId, config.cnpj);
    const nsuState = await this.nsuRedisRepo.lerNsu(config.tenantId, config.cnpj);

    // Guard anti-656: respeita o intervalo mínimo de 1h após ultNSU==maxNSU.
    if (!force && controle.proximaConsulta && controle.proximaConsulta > new Date()) {
      this.logger.debug(
        `CNPJ ${config.cnpj} aguarda próxima consulta (${controle.proximaConsulta.toISOString()}) — ignorado`,
      );
      return;
    }

    // Circuit breaker por erros consecutivos
    if (controle.errosConsecutivos >= CTE_WORKER_DEFAULTS.maxErrosConsecutivos) {
      if (!force) {
        this.logger.warn(`CNPJ ${config.cnpj} pausado por ${controle.errosConsecutivos} erros consecutivos`);
        return;
      }
      await this.nsuRepo.resetarErros(controle.id);
    }

    const lockResult = await this.nsuRedisRepo.adquirirLock(config.tenantId, config.cnpj);
    if (!lockResult.adquirido) {
      this.logger.debug(`Lock não adquirido para ${config.cnpj}: ${lockResult.motivo}`);
      return;
    }

    const { lockId } = lockResult;
    let ultimoNsu = nsuState.ultimoNsu;
    let maxNsu = nsuState.maxNsu;
    let ciclosRealizados = 0;

    try {
      const { pemCert, pemKey } = await this.certLoader.loadCert(config.tenantId, configId);

      this.auditoria
        .gravar({
          tenantId: config.tenantId,
          entidadeTipo: 'CertificadoDigital',
          entidadeId: config.certificadoId,
          acao: AuditAcao.USO,
          payloadDepois: { processo: 'DFe/CT-e', operacao: 'Distribuição automática', cnpj: config.cnpj, configId },
        })
        .catch((err) => this.logger.error('Falha ao gravar audit de distribuição CT-e', err));

      let recebeu656 = false;
      while (ciclosRealizados < maxCiclos) {
        ciclosRealizados++;

        const resultado = await this.executarCiclo({
          configId,
          controleId: controle.id,
          tenantId: config.tenantId,
          cnpj: config.cnpj,
          cUf: config.cUf,
          tpAmb: config.tpAmb as 1 | 2,
          pemCert,
          pemKey,
          ultimoNsu,
        });

        ultimoNsu = resultado.ultNSU;
        maxNsu = resultado.maxNSU;

        if (!resultado.sucesso || resultado.deveParar) {
          if (resultado.cStat === CSTAT.CONSUMO_INDEVIDO) recebeu656 = true;
          break;
        }
      }

      const jaAlcancouMax = ultimoNsu >= maxNsu;
      const configIntervaloMs = config.intervaloMinutos * 60_000;
      const proximaConsultaMs = (jaAlcancouMax || recebeu656)
        ? Math.max(configIntervaloMs, HORARIO_MIN_RECHECK_MS)
        : 60_000;

      await this.nsuRepo.agendarProximaConsulta(controle.id, new Date(Date.now() + proximaConsultaMs));
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`Erro na sincronização CT-e de ${config.cnpj}: ${msg}`, (err as Error).stack);

      try {
        await this.nsuRedisRepo.salvarNsu(config.tenantId, config.cnpj, ultimoNsu, maxNsu);
        await this.nsuRedisRepo.liberarLock(config.tenantId, config.cnpj, lockId);
        await this.nsuRepo.atualizarStats(controle.id, { ultimoNsu, maxNsu, erro: msg });
        const intervaloErroMs = Math.max(config.intervaloMinutos * 60_000, HORARIO_MIN_RECHECK_MS);
        await this.nsuRepo.agendarProximaConsulta(controle.id, new Date(Date.now() + intervaloErroMs));
      } catch (lockErr) {
        this.logger.error('Falha ao liberar lock após erro:', lockErr);
      }

      await this.nsuRepo.registrarAuditoria({
        tenantId: config.tenantId,
        cnpj: config.cnpj,
        operacao: 'SINCRONIZACAO_ERRO',
        nsuAntes: controle.ultimoNsu,
        sucesso: false,
        detalhe: msg,
      });
      return;
    }

    await this.nsuRedisRepo.salvarNsu(config.tenantId, config.cnpj, ultimoNsu, maxNsu);
    await this.nsuRedisRepo.liberarLock(config.tenantId, config.cnpj, lockId);
    await this.nsuRepo.atualizarStats(controle.id, { ultimoNsu, maxNsu });

    this.logger.log(
      `Sincronização CT-e concluída: CNPJ=${config.cnpj} ciclos=${ciclosRealizados} ultimoNsu=${ultimoNsu}`,
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Ciclo individual
  // ────────────────────────────────────────────────────────────────────────────

  private async executarCiclo(params: {
    configId: string;
    controleId: string;
    tenantId: string;
    cnpj: string;
    cUf: number;
    tpAmb: 1 | 2;
    pemCert: string;
    pemKey: string;
    ultimoNsu: string;
  }): Promise<CteCicloResultado> {
    const startMs = Date.now();

    const retDist = await this.soapClient.consultarDfe(
      { cnpj: params.cnpj, cUf: params.cUf, tpAmb: params.tpAmb, ultNSU: params.ultimoNsu },
      params.pemCert,
      params.pemKey,
    );

    const { cStat, xMotivo, ultNSU, maxNSU, documentos } = retDist;
    const duracaoMs = Date.now() - startMs;

    this.logger.log(
      `SEFAZ(CT-e) cStat=${cStat} docs=${documentos.length} ultNSU=${ultNSU} maxNSU=${maxNSU} (${duracaoMs}ms)`,
    );

    const gravarLoteSimples = async (status: 'PROCESSADO' | 'ERRO') =>
      this.prisma.cteLote.create({
        data: {
          controleId: params.controleId,
          tenantId: params.tenantId,
          cnpj: params.cnpj,
          nsuEnviado: params.ultimoNsu,
          cStat,
          xMotivo,
          ultNsuRecebido: ultNSU,
          maxNsuRecebido: maxNSU,
          qtdDocumentos: 0,
          status,
          duracaoMs,
          finalizadoEm: new Date(),
        },
      });

    if (cStat === CSTAT.CONSUMO_INDEVIDO) {
      this.logger.warn(`CNPJ ${params.cnpj}: cStat=656 (Consumo Indevido) — cooldown de 1h.`);
      await gravarLoteSimples('ERRO');
      return {
        sucesso: false, cStat, xMotivo, ultNSU, maxNSU,
        documentosBaixados: 0, duracaoMs, deveParar: true,
        erro: `Consumo Indevido — aguarde 1h (${xMotivo})`,
      };
    }

    if (cStat === CSTAT.NENHUM_DOCUMENTO) {
      await gravarLoteSimples('PROCESSADO');
      return { sucesso: true, cStat, xMotivo, ultNSU, maxNSU, documentosBaixados: 0, duracaoMs, deveParar: ultNSU >= maxNSU };
    }

    if (cStat !== CSTAT.DOCUMENTOS_LOCALIZADOS) {
      await gravarLoteSimples('ERRO');
      return { sucesso: false, cStat, xMotivo, ultNSU, maxNSU, documentosBaixados: 0, duracaoMs, deveParar: true, erro: xMotivo };
    }

    // cStat === '138' — processa documentos
    const lote = await this.prisma.cteLote.create({
      data: {
        controleId: params.controleId,
        tenantId: params.tenantId,
        cnpj: params.cnpj,
        nsuEnviado: params.ultimoNsu,
        cStat,
        xMotivo,
        ultNsuRecebido: ultNSU,
        maxNsuRecebido: maxNSU,
        qtdDocumentos: documentos.length,
        status: 'PROCESSANDO',
        duracaoMs,
      },
    });

    // Processa os documentos do lote em POOL paralelo (perf multi-CNPJ).
    const documentosBaixados = await this.processarDocsEmPool(
      documentos,
      lote.id,
      params.tenantId,
      params.cnpj,
      CTE_WORKER_DEFAULTS.concorrenciaDocsPorLote,
    );

    await this.prisma.cteLote.update({
      where: { id: lote.id },
      data: { status: 'PROCESSADO', finalizadoEm: new Date(), qtdDocumentos: documentosBaixados },
    });

    await this.nsuRepo.incrementarDocumentosBaixados(params.controleId, documentosBaixados);

    const nsusLote = documentos.map((d) => d.nsu);
    await this.gapDetector
      .detectarGaps(params.tenantId, params.cnpj, params.configId, nsusLote)
      .catch((err: Error) =>
        this.logger.error(`Falha na detecção de gaps (CNPJ=${params.cnpj}): ${err.message}`, err.stack),
      );

    await this.nsuRepo.registrarAuditoria({
      tenantId: params.tenantId,
      cnpj: params.cnpj,
      operacao: 'LOTE_PROCESSADO',
      nsuAntes: params.ultimoNsu,
      nsuDepois: ultNSU,
      cStat,
      sucesso: true,
      detalhe: `${documentosBaixados} documentos processados`,
      duracaoMs,
    });

    return { sucesso: true, loteId: lote.id, cStat, xMotivo, ultNSU, maxNSU, documentosBaixados, duracaoMs, deveParar: ultNSU >= maxNSU };
  }

  /**
   * Processa os documentos de um lote com paralelismo limitado (pool de N workers).
   * Cada doc é idempotente por (tenantId, nsu); falhas individuais são logadas e
   * não interrompem o lote. JS é single-thread → o incremento do contador é seguro.
   */
  private async processarDocsEmPool(
    documentos: Awaited<ReturnType<CteSoapClientService['consultarDfe']>>['documentos'],
    loteId: string,
    tenantId: string,
    cnpj: string,
    concorrencia: number,
  ): Promise<number> {
    let baixados = 0;
    let idx = 0;

    const worker = async () => {
      for (;;) {
        const i = idx++;
        if (i >= documentos.length) return;
        const doc = documentos[i]!;
        try {
          const processado = await this.xmlProcessor.processarDocumento(doc, loteId, tenantId, cnpj);
          if (processado) baixados++;
        } catch (err) {
          this.logger.error(
            `Falha ao processar NSU ${doc.nsu}: ${(err as Error).message}`,
            (err as Error).stack,
          );
        }
      }
    };

    const n = Math.max(1, Math.min(concorrencia, documentos.length));
    await Promise.all(Array.from({ length: n }, () => worker()));
    return baixados;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Listagens
  // ────────────────────────────────────────────────────────────────────────────

  async listarDocumentos(tenantId: string, query: ListarCteDocumentosQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

    const where: Prisma.CteDocumentoWhereInput = { tenantId };
    if (query.cnpj) where.cnpjInteressado = query.cnpj.replace(/\D/g, '');
    if (query.tipo) where.tipoDocumento = query.tipo as Prisma.CteDocumentoWhereInput['tipoDocumento'];
    if (query.modelo) where.modelo = Number(query.modelo);
    if (query.chaveAcesso) where.chaveAcesso = query.chaveAcesso.replace(/\D/g, '');
    if (query.cteEmitenteCnpj) where.cteEmitenteCnpj = query.cteEmitenteCnpj.replace(/\D/g, '');
    if (query.cteTomadorCnpj) where.cteTomadorCnpj = query.cteTomadorCnpj.replace(/\D/g, '');
    if (query.dataInicio || query.dataFim) {
      where.cteDhEmissao = {};
      if (query.dataInicio) where.cteDhEmissao.gte = new Date(query.dataInicio);
      if (query.dataFim) where.cteDhEmissao.lte = new Date(query.dataFim);
    }
    if (query.valorMin !== undefined || query.valorMax !== undefined) {
      where.cteValorPrestacao = {};
      if (query.valorMin !== undefined) where.cteValorPrestacao.gte = Number(query.valorMin);
      if (query.valorMax !== undefined) where.cteValorPrestacao.lte = Number(query.valorMax);
    }

    const [total, data] = await this.prisma.$transaction([
      this.prisma.cteDocumento.count({ where }),
      this.prisma.cteDocumento.findMany({
        where,
        orderBy: { cteDhEmissao: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, nsu: true, tipoDocumento: true, modelo: true, chaveAcesso: true,
          cteEmitenteCnpj: true, cteEmitenteNome: true, cteValorPrestacao: true,
          cteDhEmissao: true, cteSituacao: true, tpCte: true, modal: true,
          ufIni: true, ufFim: true, cteTomadorCnpj: true, cteRemetenteCnpj: true,
          cteDestinatarioCnpj: true, cteExpedidorCnpj: true, cteRecebedorCnpj: true,
          cteChavesNfe: true, eventoTipo: true,
          eventoDescricao: true, criadoEm: true,
        },
      }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async listarEventos(tenantId: string, documentoId: string) {
    return this.prisma.cteEvento.findMany({
      where: { tenantId, documentoId },
      orderBy: { criadoEm: 'desc' },
    });
  }
}
