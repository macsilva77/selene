import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditAcao, DfeGapStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { DfeCertLoaderService } from './dfe-cert-loader.service';
import { DfeSoapClientService } from './dfe-soap-client.service';
import { DfeNsuControlRepository } from './dfe-nsu-control.repository';
import { DfeNsuRedisRepository } from './dfe-nsu-redis.repository';
import { DfeStorageService } from './dfe-storage.service';
import { DfeXmlProcessorService } from './dfe-xml-processor.service';
import { DfeGapDetectorService } from './dfe-gap-detector.service';
import { DfeVarreduraService } from './dfe-varredura.service';
import { ConfigurarDfeDto } from './dto/configurar-dfe.dto';
import { buildMeta, parsePagination } from '../../common/utils/pagination.helper';
import {
  CSTAT,
  DFE_WORKER_DEFAULTS,
  DfeCicloResultado,
  HORARIO_MIN_RECHECK_MS,
} from './dfe.types';

/** Mapa de sigla UF → código IBGE */
const UF_PARA_CUF: Record<string, number> = {
  AC: 12, AL: 27, AP: 16, AM: 13, BA: 29, CE: 23,
  DF: 53, ES: 32, GO: 52, MA: 21, MT: 51, MS: 50,
  MG: 31, PA: 15, PB: 25, PR: 41, PE: 26, PI: 22,
  RJ: 33, RN: 24, RS: 43, RO: 11, RR: 14, SC: 42,
  SP: 35, SE: 28, TO: 17,
};

/**
 * Orquestra a distribuição DF-e:
 *  - Configuração (criar DfeConfig + DfeNsuControle)
 *  - Ciclo de distribuição (SOAP → lote → documentos → NSU update)
 *  - Status (retorna configurações e estatísticas de NSU)
 */
@Injectable()
export class DfeDistribuicaoService {
  private readonly logger = new Logger(DfeDistribuicaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly certLoader: DfeCertLoaderService,
    private readonly soapClient: DfeSoapClientService,
    private readonly nsuRepo: DfeNsuControlRepository,
    private readonly nsuRedisRepo: DfeNsuRedisRepository,
    private readonly xmlProcessor: DfeXmlProcessorService,
    private readonly gapDetector: DfeGapDetectorService,
    private readonly auditoria: AuditoriaService,
    private readonly varredura: DfeVarreduraService,
    private readonly storageService: DfeStorageService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────────
  // Configuração
  // ────────────────────────────────────────────────────────────────────────────

  async configurarDfe(
    tenantId: string,
    usuarioId: string,
    dto: ConfigurarDfeDto,
  ) {
    // Verifica se já existe configuração para este CNPJ no tenant
    const existente = await this.prisma.dfeConfig.findUnique({
      where: { tenantId_cnpj: { tenantId, cnpj: dto.cnpj } },
    });
    if (existente) {
      throw new ConflictException(
        `Já existe uma configuração DF-e para o CNPJ ${dto.cnpj} neste tenant.`,
      );
    }

    // Deriva cUf a partir da empresa cadastrada (CNPJ armazenado sem pontuação)
    const empresa = await this.prisma.empresa.findUnique({
      where: { tenantId_cnpj: { tenantId, cnpj: dto.cnpj } },
      select: { uf: true, nome: true },
    });
    if (!empresa) {
      throw new NotFoundException(
        `CNPJ ${dto.cnpj} não está cadastrado em Empresas para este tenant. Cadastre a empresa primeiro.`,
      );
    }
    const cUf = empresa.uf ? UF_PARA_CUF[empresa.uf.toUpperCase()] : undefined;
    if (!cUf) {
      throw new BadRequestException(
        `A empresa (${empresa.nome}) não possui UF válida cadastrada. Atualize o cadastro da empresa.`,
      );
    }

    // Verifica se o certificado pertence ao tenant
    const cert = await this.prisma.certificadoDigital.findFirst({
      where: { id: dto.certificadoId, tenantId, ativo: true },
    });
    if (!cert) {
      throw new NotFoundException(
        `Certificado ${dto.certificadoId} não encontrado ou inativo para este tenant.`,
      );
    }

    if (!cert.certPemEnc || !cert.keyPemEnc) {
      throw new BadRequestException(
        'O certificado selecionado não possui chave privada PEM armazenada. Reimporte o certificado.',
      );
    }

    // Cria DfeConfig + DfeNsuControle em transação
    const config = await this.prisma.$transaction(async (tx) => {
      const config = await tx.dfeConfig.create({
        data: {
          tenantId,
          cnpj: dto.cnpj,
          cUf,
          tpAmb: dto.tpAmb,
          certificadoId: dto.certificadoId,
          horarioCaptura: dto.horarioCaptura,
          intervaloMinutos: dto.intervaloMinutos,
          ativo: true,
          criadoPorId: usuarioId,
        },
      });

      await tx.dfeNsuControle.create({
        data: {
          configId: config.id,
          tenantId,
          cnpj: dto.cnpj,
          ultimoNsu: '000000000000000',
          maxNsu: '000000000000000',
          emProcessamento: false,
        },
      });

      return config;
    });

    this.logger.log(`DfeConfig criada: id=${config.id} cnpj=${dto.cnpj} uf=${empresa.uf} tenant=${tenantId}`);

    this.auditoria.gravar({
      tenantId,
      entidadeTipo: 'CertificadoDigital',
      entidadeId: dto.certificadoId,
      acao: AuditAcao.USO,
      usuarioId,
      payloadDepois: { processo: 'DFe/NF-e', operacao: 'Configuração de captura', cnpj: dto.cnpj, configId: config.id },
    }).catch((err) => this.logger.error('Falha ao gravar audit de uso de certificado', err));

    return { id: config.id, cnpj: config.cnpj, cUf: config.cUf, tpAmb: config.tpAmb, criadoEm: config.criadoEm };
  }

  async assertConfigBelongsToTenant(configId: string, tenantId: string) {
    const config = await this.prisma.dfeConfig.findFirst({ where: { id: configId, tenantId } });
    if (!config) throw new NotFoundException('Configuração DFe não encontrada');
    return config;
  }

  /**
   * Zera o NSU da configuração e libera o cooldown para recuperação completa dos 90 dias.
   * Inicia automaticamente a varredura retroativa do intervalo [0, maxNSU] para
   * recuperar documentos históricos não capturados pelo distNSU.
   */
  async resetarNsu(tenantId: string, configId: string): Promise<void> {
    const config = await this.assertConfigBelongsToTenant(configId, tenantId);
    const controle = await this.nsuRepo.obterOuCriarControle(configId, tenantId, config.cnpj);

    // Salva maxNSU antes de zerar — será o limite superior da varredura
    const maxNsuAtual = controle.maxNsu;

    await this.nsuRedisRepo.resetarNsu(tenantId, config.cnpj);
    await this.nsuRepo.resetarNsu(controle.id);

    // Inicia varredura retroativa automaticamente se houver NSUs conhecidos
    if (maxNsuAtual && maxNsuAtual !== '000000000000000') {
      this.varredura.iniciarVarredura(tenantId, configId, '0', maxNsuAtual).catch((err) =>
        this.logger.error(`Falha ao iniciar varredura após reset NSU (configId=${configId}): ${(err as Error).message}`),
      );
      this.logger.log(`Reset NSU: varredura retroativa iniciada automaticamente [0 → ${maxNsuAtual}] para CNPJ=${config.cnpj}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Status
  // ────────────────────────────────────────────────────────────────────────────

  async toggleAtivo(tenantId: string, configId: string): Promise<{ id: string; ativo: boolean }> {
    const config = await this.prisma.dfeConfig.findFirst({
      where: { id: configId, tenantId },
    });
    if (!config) throw new NotFoundException('Configuração DFe não encontrada');

    const updated = await this.prisma.dfeConfig.update({
      where: { id: configId },
      data: { ativo: !config.ativo },
      select: { id: true, ativo: true },
    });

    this.logger.log(
      `Config ${configId} (${config.cnpj}) ${updated.ativo ? 'ATIVADA' : 'DESATIVADA'} pelo tenant ${tenantId}`,
    );

    // Invalida cache de cert caso seja desativado
    if (!updated.ativo) this.certLoader.invalidate(tenantId, configId);

    return updated;
  }

  async getStatus(tenantId: string) {
    const configs = await this.prisma.dfeConfig.findMany({
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

    // Busca nomes das empresas pelo CNPJ
    const cnpjs = [...new Set(configs.map((c) => c.cnpj))];
    const empresas = await this.prisma.empresa.findMany({
      where: { tenantId, cnpj: { in: cnpjs } },
      select: { cnpj: true, nome: true, nomeFantasia: true },
    });
    const empresaMap = new Map(empresas.map((e) => [e.cnpj, e]));

    return configs.map((c) => {
      const controle = c.controle
        ? (() => { const { lotes, ...rest } = c.controle!; return { ...rest, ultimoLote: lotes[0] ?? null }; })()
        : null;
      const empresa = empresaMap.get(c.cnpj);
      return {
        id: c.id,
        cnpj: c.cnpj,
        nomeFantasia: empresa?.nomeFantasia ?? null,
        nome: empresa?.nome ?? null,
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

  // ────────────────────────────────────────────────────────────────────────────
  // Sincronização
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Executa um ciclo completo de distribuição para uma configuração.
   *
   * - Adquire lock distribuído
   * - Chama SEFAZ em loop enquanto houver documentos (cStat=138)
   * - Persiste documentos e atualiza NSU
   * - Libera lock ao finalizar
   *
   * @param configId ID do DfeConfig
   * @param maxCiclos Máximo de lotes por execução (proteção contra loop infinito)
   */
  async sincronizarDfe(configId: string, maxCiclos = DFE_WORKER_DEFAULTS.maxCiclosPorExecucao, force = false): Promise<void> {
    const config = await this.prisma.dfeConfig.findUnique({
      where: { id: configId },
    });

    if (!config?.ativo) {
      this.logger.warn(`Configuração ${configId} não encontrada ou inativa — ignorada`);
      return;
    }

    const controle = await this.nsuRepo.obterOuCriarControle(configId, config.tenantId, config.cnpj);
    const nsuState = await this.nsuRedisRepo.lerNsu(config.tenantId, config.cnpj);

    // Guard anti-656: respeita o intervalo mínimo de 1h após ultNSU==maxNSU
    // (MOC 7.0 §5.7.4.4 — consultas repetidas antes do intervalo resultam em cStat=656)
    // Ignorado quando `force=true` (sincronização manual pelo usuário).
    if (!force && controle.proximaConsulta && controle.proximaConsulta > new Date()) {
      this.logger.debug(
        `CNPJ ${config.cnpj} aguarda próxima consulta programada (${controle.proximaConsulta.toISOString()}) — ignorado`,
      );
      return;
    }
    if (force && controle.proximaConsulta && controle.proximaConsulta > new Date()) {
      this.logger.log(
        `CNPJ ${config.cnpj}: sincronização forçada pelo usuário (ignorando cooldown de ${controle.proximaConsulta.toISOString()})`,
      );
    }

    // Verifica circuit breaker por erros consecutivos
    if (controle.errosConsecutivos >= DFE_WORKER_DEFAULTS.maxErrosConsecutivos) {
      this.logger.warn(
        `CNPJ ${config.cnpj} pausado por ${controle.errosConsecutivos} erros consecutivos`,
      );
      return;
    }

    // Adquire lock via Redis (atômico, TTL automático)
    const lockResult = await this.nsuRedisRepo.adquirirLock(config.tenantId, config.cnpj);
    if (!lockResult.adquirido) {
      this.logger.debug(`Lock não adquirido para ${config.cnpj}: ${lockResult.motivo}`);
      return;
    }

    const { lockId } = lockResult;
    let ultimoNsu = nsuState.ultimoNsu;
    let maxNsu = nsuState.maxNsu;
    let ciclosRealizados = 0;
    // Detecta primeira sincronização (NSU ainda zerado) para disparar varredura ao final
    const isPrimeiraSinc = nsuState.ultimoNsu === '000000000000000';

    try {
      const { pemCert, pemKey } = await this.certLoader.loadCert(config.tenantId, configId);

      this.auditoria.gravar({
        tenantId: config.tenantId,
        entidadeTipo: 'CertificadoDigital',
        entidadeId: config.certificadoId,
        acao: AuditAcao.USO,
        payloadDepois: { processo: 'DFe/NF-e', operacao: 'Distribuição automática', cnpj: config.cnpj, configId },
      }).catch((err) => this.logger.error('Falha ao gravar audit de distribuição DFe', err));

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
          lockId,
        });

        ultimoNsu = resultado.ultNSU;
        maxNsu = resultado.maxNSU;

        if (!resultado.sucesso || resultado.deveParar) {
          if (resultado.cStat === CSTAT.CONSUMO_INDEVIDO) {
            recebeu656 = true;
          }
          break;
        }
      }

      // Agenda próxima consulta com base no estado final e no intervalo configurado
      const jaAlcancouMax = ultimoNsu >= maxNsu;
      const configIntervaloMs = config.intervaloMinutos * 60_000;
      // MOC 7.0 §5.7.4.4: quando ultNSU==maxNSU (sem mais documentos), aguardar no mínimo 1h
      // para evitar cStat=656 (Consumo Indevido) na consulta seguinte.
      // Se recebeu 656 explicitamente, força sempre o cooldown de 1h.
      const proximaConsultaMs = (jaAlcancouMax || recebeu656)
        ? Math.max(configIntervaloMs, HORARIO_MIN_RECHECK_MS)
        : 60_000; // 1 min enquanto ainda há documentos pendentes

      await this.nsuRepo.agendarProximaConsulta(controle.id, new Date(Date.now() + proximaConsultaMs));

      // Se o distNSU recebeu 656, pausa também qualquer varredura ativa para que o
      // CNPJ não continue batendo na SEFAZ durante o cooldown.
      if (recebeu656) {
        await this.prisma.dfeVarreduraNsu.updateMany({
          where: { configId, status: 'ATIVA' },
          data: {
            status: 'PAUSADA',
            pausadoEm: new Date(),
            ultimoErro: `Consumo Indevido (656) no distNSU — aguardar 1h antes de retomar`,
          },
        });
      }

    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`Erro na sincronização de ${config.cnpj}: ${msg}`, (err as Error).stack);

      // Libera lock Redis e atualiza stats PostgreSQL mesmo em caso de erro
      try {
        await this.nsuRedisRepo.salvarNsu(config.tenantId, config.cnpj, ultimoNsu, maxNsu);
        await this.nsuRedisRepo.liberarLock(config.tenantId, config.cnpj, lockId);
        await this.nsuRepo.atualizarStats(controle.id, { ultimoNsu, maxNsu, erro: msg });
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

    // Libera lock Redis e atualiza stats PostgreSQL com sucesso
    await this.nsuRedisRepo.salvarNsu(config.tenantId, config.cnpj, ultimoNsu, maxNsu);
    await this.nsuRedisRepo.liberarLock(config.tenantId, config.cnpj, lockId);
    await this.nsuRepo.atualizarStats(controle.id, { ultimoNsu, maxNsu });

    this.logger.log(
      `Sincronização concluída: CNPJ=${config.cnpj} ciclos=${ciclosRealizados} ultimoNsu=${ultimoNsu}`,
    );

    // Primeira sincronização concluída: agora sabemos o maxNSU — inicia varredura retroativa
    // para recuperar documentos emitidos antes do CNPJ ser configurado no sistema.
    if (isPrimeiraSinc && maxNsu && maxNsu !== '000000000000000') {
      this.varredura.iniciarVarredura(config.tenantId, configId, '0', maxNsu).catch((err) =>
        this.logger.error(`Falha ao iniciar varredura na primeira sync (configId=${configId}): ${(err as Error).message}`),
      );
      this.logger.log(`Primeira sync: varredura retroativa iniciada automaticamente [0 → ${maxNsu}] para CNPJ=${config.cnpj}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Ciclo individual de distribuição
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
    lockId: string;
  }): Promise<DfeCicloResultado> {
    const startMs = Date.now();

    // O retry com backoff está encapsulado dentro do DfeSoapClientService
    const retDist = await this.soapClient.consultarDfe(
      {
        cnpj: params.cnpj,
        cUf: params.cUf,
        tpAmb: params.tpAmb,
        ultNSU: params.ultimoNsu,
      },
      params.pemCert,
      params.pemKey,
    );

    const { cStat, xMotivo, ultNSU, maxNSU, documentos } = retDist;
    const duracaoMs = Date.now() - startMs;

    this.logger.log(
      `SEFAZ cStat=${cStat} docs=${documentos.length} ultNSU=${ultNSU} maxNSU=${maxNSU} (${duracaoMs}ms)`,
    );

    // Grava lote para TODOS os retornos SEFAZ (histórico completo)
    const gravarLoteSimples = async (status: 'PROCESSADO' | 'ERRO') =>
      this.prisma.dfeLote.create({
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

    // Tratamento por cStat
    if (cStat === CSTAT.CONSUMO_INDEVIDO) {
      this.logger.warn(
        `CNPJ ${params.cnpj}: cStat=656 (Consumo Indevido) — aguardará cooldown de 1h antes de retentar.`,
      );
      await gravarLoteSimples('ERRO');
      return {
        sucesso: false, cStat, xMotivo, ultNSU, maxNSU,
        documentosBaixados: 0, duracaoMs, deveParar: true,
        erro: `Consumo Indevido — aguarde 1h (${xMotivo})`,
      };
    }

    if (cStat === CSTAT.NENHUM_DOCUMENTO) {
      await gravarLoteSimples('PROCESSADO');
      const deveParar = ultNSU >= maxNSU;
      return { sucesso: true, cStat, xMotivo, ultNSU, maxNSU, documentosBaixados: 0, duracaoMs, deveParar };
    }

    if (cStat === CSTAT.CNPJ_BASE_DIVERGENTE) {
      this.logger.warn(`SEFAZ retornou cStat=593 (somente um CNPJ por vez) — lock pode ter expirado`);
      await gravarLoteSimples('ERRO');
      return { sucesso: false, cStat, xMotivo, ultNSU, maxNSU, documentosBaixados: 0, duracaoMs, deveParar: true, erro: xMotivo };
    }

    if (cStat !== CSTAT.DOCUMENTOS_LOCALIZADOS) {
      await gravarLoteSimples('ERRO');
      return { sucesso: false, cStat, xMotivo, ultNSU, maxNSU, documentosBaixados: 0, duracaoMs, deveParar: true, erro: xMotivo };
    }

    // cStat === '138' — processa documentos
    const lote = await this.prisma.dfeLote.create({
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

    let documentosBaixados = 0;
    for (const doc of documentos) {
      try {
        const processado = await this.xmlProcessor.processarDocumento(
          doc,
          lote.id,
          params.tenantId,
          params.cnpj,
        );
        if (processado) documentosBaixados++;
      } catch (err) {
        this.logger.error(
          `Falha ao processar NSU ${doc.nsu}: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    }

    // Atualiza o lote
    await this.prisma.dfeLote.update({
      where: { id: lote.id },
      data: {
        status: 'PROCESSADO',
        finalizadoEm: new Date(),
        qtdDocumentos: documentosBaixados,
      },
    });

    // Incrementa contador de docs
    await this.nsuRepo.incrementarDocumentosBaixados(params.controleId, documentosBaixados);

    // Detecta e registra lacunas NSU — MOC 7.0 seção 5.7.4.5
    // Executado após o processamento para não bloquear o fluxo principal em caso de falha
    const nsusLote = documentos.map((d) => d.nsu);
    await this.gapDetector
      .detectarGaps(params.tenantId, params.cnpj, params.configId, nsusLote)
      .catch((err: Error) =>
        this.logger.error(
          `Falha na detecção de gaps (CNPJ=${params.cnpj}): ${err.message}`,
          err.stack,
        ),
      );

    // Registra auditoria
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

    // Continua enquanto o NSU não atingiu o máximo
    const deveParar = ultNSU >= maxNSU;

    return { sucesso: true, loteId: lote.id, cStat, xMotivo, ultNSU, maxNSU, documentosBaixados, duracaoMs, deveParar };
  }

  // ── fim ──────────────────────────────────────────────────────────────────────

  // ────────────────────────────────────────────────────────────────────────────
  // Listagem de documentos
  // ────────────────────────────────────────────────────────────────────────────

  // ────────────────────────────────────────────────────────────────────────────
  // Filtros compartilhados — listagem e exportação
  // ────────────────────────────────────────────────────────────────────────────

  private async buildDocumentosWhere(
    tenantId: string,
    params: {
      cnpj?: string;
      cnpjEmitente?: string;
      cnpjTransportador?: string;
      cnpjAutXml?: string;
      tipo?: string;
      dataInicio?: string;
      dataFim?: string;
      chaveAcesso?: string;
      valorMin?: number;
      valorMax?: number;
      configId?: string;
      raizCnpj?: boolean;
      nNF?: string;
      etiquetaIds?: string[];
    },
  ): Promise<Record<string, unknown>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = { tenantId };

    if (params.configId) {
      const config = await this.prisma.dfeConfig.findFirst({
        where: { id: params.configId, tenantId },
        select: { cnpj: true },
      });
      if (config) where['cnpjDestinatario'] = config.cnpj;
    } else if (params.cnpj) {
      if (params.raizCnpj) {
        const base = params.cnpj.replace(/\D/g, '').slice(0, 8);
        where['cnpjDestinatario'] = { startsWith: base };
      } else {
        where['cnpjDestinatario'] = params.cnpj.replace(/\D/g, '');
      }
    }

    if (params.cnpjEmitente) {
      const base = params.cnpjEmitente.replace(/\D/g, '');
      where['nfeEmitenteCnpj'] = params.raizCnpj ? { startsWith: base.slice(0, 8) } : base;
    }

    if (params.cnpjTransportador) {
      const base = params.cnpjTransportador.replace(/\D/g, '');
      where['nfeTransportadorCnpj'] = params.raizCnpj ? { startsWith: base.slice(0, 8) } : base;
    }

    if (params.cnpjAutXml) {
      where['nfeAutXmlCnpjs'] = { contains: params.cnpjAutXml.replace(/\D/g, '') };
    }

    if (params.tipo) where['tipoDocumento'] = params.tipo;
    if (params.chaveAcesso) where['chaveAcesso'] = { contains: params.chaveAcesso };
    if (params.nNF) {
      const nNFPadded = params.nNF.replace(/\D/g, '').padStart(9, '0');
      where['chaveAcesso'] = { ...where['chaveAcesso'], contains: nNFPadded };
    }

    if (params.dataInicio ?? params.dataFim) {
      where['nfeDhEmissao'] = {};
      if (params.dataInicio) where['nfeDhEmissao']['gte'] = new Date(params.dataInicio);
      if (params.dataFim) where['nfeDhEmissao']['lte'] = new Date(params.dataFim + 'T23:59:59');
    }

    if (params.valorMin != null || params.valorMax != null) {
      where['nfeValorTotal'] = {};
      if (params.valorMin != null) where['nfeValorTotal']['gte'] = params.valorMin;
      if (params.valorMax != null) where['nfeValorTotal']['lte'] = params.valorMax;
    }

    // Filtro por etiquetas — OR lógico: exibe docs com qualquer uma das etiquetas selecionadas
    if (params.etiquetaIds && params.etiquetaIds.length > 0) {
      where['etiquetas'] = { some: { etiquetaId: { in: params.etiquetaIds } } };
    }

    return where;
  }

  async listarDocumentos(
    tenantId: string,
    params: {
      page?: number;
      limit?: number;
      cnpj?: string;
      cnpjEmitente?: string;
      cnpjTransportador?: string;
      cnpjAutXml?: string;
      tipo?: string;
      dataInicio?: string;
      dataFim?: string;
      chaveAcesso?: string;
      valorMin?: number;
      valorMax?: number;
      configId?: string;
      raizCnpj?: boolean;
      nNF?: string;
      etiquetaIds?: string[];
    },
  ) {
    const { page, limit, skip } = parsePagination(params);
    const where = await this.buildDocumentosWhere(tenantId, params);

    const [total, documentos] = await Promise.all([
      this.prisma.dfeDocumento.count({ where }),
      this.prisma.dfeDocumento.findMany({
        where,
        select: {
          id: true,
          nsu: true,
          tipoDocumento: true,
          chaveAcesso: true,
          nfeEmitenteCnpj: true,
          nfeEmitenteNome: true,
          nfeValorTotal: true,
          nfeDhEmissao: true,
          nfeSituacao: true,
          eventoTipo: true,
          eventoDescricao: true,
          cnpjDestinatario: true,
          schema: true,
          processado: true,
          criadoEm: true,
          manifestacoes: {
            select: {
              tpEvento: true,
              xEvento: true,
              status: true,
              nProt: true,
              enviadoEm: true,
            },
            orderBy: { criadoEm: 'desc' as const },
            take: 1,
          },
          etiquetas: {
            select: {
              etiqueta: { select: { id: true, nome: true, cor: true } },
            },
          },
        },
        orderBy: { criadoEm: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: documentos.map(({ manifestacoes, etiquetas, ...d }) => ({
        ...d,
        nfeValorTotal: d.nfeValorTotal ? Number(d.nfeValorTotal) : null,
        ultimaManifestacao: manifestacoes[0] ?? null,
        etiquetas: etiquetas.map((e) => e.etiqueta),
      })),
      meta: buildMeta(total, page, limit),
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Exportação CSV
  // ────────────────────────────────────────────────────────────────────────────

  async exportarDocumentos(
    tenantId: string,
    params: {
      cnpj?: string;
      cnpjEmitente?: string;
      cnpjTransportador?: string;
      cnpjAutXml?: string;
      tipo?: string;
      dataInicio?: string;
      dataFim?: string;
      chaveAcesso?: string;
      valorMin?: number;
      valorMax?: number;
      configId?: string;
      raizCnpj?: boolean;
      nNF?: string;
      etiquetaIds?: string[];
    },
  ): Promise<Buffer> {
    const where = await this.buildDocumentosWhere(tenantId, params);

    const documentos = await this.prisma.dfeDocumento.findMany({
      where,
      select: {
        nsu: true,
        chaveAcesso: true,
        tipoDocumento: true,
        nfeEmitenteCnpj: true,
        nfeEmitenteNome: true,
        nfeValorTotal: true,
        nfeDhEmissao: true,
        nfeSituacao: true,
        eventoTipo: true,
        eventoDescricao: true,
        cnpjDestinatario: true,
        etiquetas: {
          select: { etiqueta: { select: { nome: true } } },
        },
      },
      orderBy: { criadoEm: 'desc' },
    });

    const csvEscape = (v: string) => {
      if (v.includes(',') || v.includes('"') || v.includes('\n')) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return v;
    };

    const headers = [
      'NSU', 'Chave NF-e', 'Tipo', 'CNPJ Emitente', 'Nome Emitente',
      'CNPJ Destinatário', 'Emissão', 'Valor Total (R$)', 'Situação',
      'Tipo Evento', 'Desc. Evento', 'Etiquetas',
    ];

    const rows = documentos.map((doc) => [
      doc.nsu ?? '',
      doc.chaveAcesso ?? '',
      doc.tipoDocumento,
      doc.nfeEmitenteCnpj ?? '',
      doc.nfeEmitenteNome ?? '',
      doc.cnpjDestinatario ?? '',
      doc.nfeDhEmissao ? new Date(doc.nfeDhEmissao).toLocaleDateString('pt-BR') : '',
      doc.nfeValorTotal ? Number(doc.nfeValorTotal).toFixed(2) : '',
      doc.nfeSituacao ?? '',
      doc.eventoTipo ?? '',
      doc.eventoDescricao ?? '',
      doc.etiquetas.length > 0 ? doc.etiquetas.map((e) => e.etiqueta.nome).join(', ') : '-',
    ].map(csvEscape).join(','));

    // BOM UTF-8 para compatibilidade com Excel no Windows
    const csv = [headers.join(','), ...rows].join('\r\n');
    return Buffer.from('﻿' + csv, 'utf8');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Download de XML
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Retorna o XML bruto de um documento DFe armazenado.
   * O buffer é enviado ao client via StreamableFile no controller.
   */
  async obterXmlDocumento(tenantId: string, documentoId: string) {
    const doc = await this.prisma.dfeDocumento.findFirst({
      where: { id: documentoId, tenantId },
      select: {
        xmlOriginal: true,
        xmlStoragePath: true,
        chaveAcesso: true,
        tipoDocumento: true,
        schema: true,
        cnpjDestinatario: true,
      },
    });
    if (!doc) throw new NotFoundException('Documento DFe não encontrado');

    const xmlBuffer = await this.storageService.resolverXml(doc);
    return { ...doc, xmlBuffer };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Gaps NSU
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Lista lotes de requisição SEFAZ do tenant com paginação.
   * Filtros opcionais: configId (via controle) e cnpj.
   */
  async listarLotes(
    tenantId: string,
    params: {
      configId?: string;
      cnpj?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { page, limit, skip } = parsePagination(params);

    const where: import('@prisma/client').Prisma.DfeLoteWhereInput = { tenantId };
    if (params.configId) where.controle = { configId: params.configId };
    if (params.cnpj) where.cnpj = params.cnpj;

    const [total, lotes] = await Promise.all([
      this.prisma.dfeLote.count({ where }),
      this.prisma.dfeLote.findMany({
        where,
        select: {
          id: true,
          cnpj: true,
          nsuEnviado: true,
          cStat: true,
          xMotivo: true,
          ultNsuRecebido: true,
          maxNsuRecebido: true,
          qtdDocumentos: true,
          status: true,
          duracaoMs: true,
          iniciadoEm: true,
          finalizadoEm: true,
          erroMensagem: true,
        },
        orderBy: { iniciadoEm: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return { data: lotes, meta: buildMeta(total, page, limit) };
  }

  /**
   * Lista gaps NSU do tenant com paginação e filtros opcionais.
   */
  async listarGaps(
    tenantId: string,
    params: {
      page?: number;
      limit?: number;
      status?: string;
      cnpj?: string;
    },
  ) {
    const { page, limit, skip } = parsePagination(params);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = { tenantId };
    if (params.cnpj) where['cnpj'] = params.cnpj;
    if (params.status) where['status'] = params.status;

    const [total, gaps] = await Promise.all([
      this.prisma.dfeGapNsu.count({ where }),
      this.prisma.dfeGapNsu.findMany({
        where,
        select: {
          id: true,
          cnpj: true,
          nsuFaltante: true,
          status: true,
          tentativas: true,
          nsuAnterior: true,
          nsuPosterior: true,
          proximaTentativa: true,
          recuperadoEm: true,
          erroMensagem: true,
          criadoEm: true,
        },
        orderBy: { criadoEm: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: gaps,
      meta: buildMeta(total, page, limit),
    };
  }

  /**
   * Força a recuperação manual de um gap NSU específico via `consNSU`.
   *
   * @throws NotFoundException se o gap não pertencer ao tenant
   * @throws BadRequestException se o gap não estiver em status PENDENTE ou ESGOTADO
   */
  async recuperarGap(tenantId: string, gapId: string) {
    const gap = await this.prisma.dfeGapNsu.findFirst({
      where: { id: gapId, tenantId },
      include: {
        config: {
          select: { id: true, cnpj: true, cUf: true, tpAmb: true },
        },
      },
    });

    if (!gap) throw new NotFoundException('Gap NSU não encontrado');

    if (gap.status !== DfeGapStatus.PENDENTE && gap.status !== DfeGapStatus.ESGOTADO) {
      throw new BadRequestException(
        `Gap já resolvido com status "${gap.status}". Apenas gaps PENDENTE ou ESGOTADO podem ser recuperados manualmente.`,
      );
    }

    // Reativa gap esgotado para nova tentativa
    if (gap.status === DfeGapStatus.ESGOTADO) {
      await this.prisma.dfeGapNsu.update({
        where: { id: gapId },
        data: { status: DfeGapStatus.PENDENTE, tentativas: 0 },
      });
    }

    const { pemCert, pemKey } = await this.certLoader.loadCert(tenantId, gap.configId);
    const inicio = Date.now();

    const ret = await this.soapClient.consultarNSU(
      {
        cnpj: gap.config.cnpj,
        cUf: gap.config.cUf,
        tpAmb: gap.config.tpAmb as 1 | 2,
        nsu: gap.nsuFaltante,
      },
      pemCert,
      pemKey,
    );

    const duracaoMs = Date.now() - inicio;

    if (ret.cStat === CSTAT.DOCUMENTOS_LOCALIZADOS) {
      // Cria lote de recuperação e processa documentos
      const controle = await this.nsuRepo.obterOuCriarControle(
        gap.configId,
        tenantId,
        gap.config.cnpj,
      );

      const lote = await this.prisma.dfeLote.create({
        data: {
          controleId: controle.id,
          tenantId,
          cnpj: gap.config.cnpj,
          nsuEnviado: gap.nsuFaltante,
          cStat: ret.cStat,
          xMotivo: ret.xMotivo,
          ultNsuRecebido: ret.ultNSU,
          maxNsuRecebido: ret.maxNSU,
          qtdDocumentos: ret.documentos.length,
          status: 'PROCESSANDO',
          duracaoMs,
        },
      });

      let documentoId: string | undefined;
      for (const rawDoc of ret.documentos) {
        const processado = await this.xmlProcessor
          .processarDocumento(rawDoc, lote.id, tenantId, gap.config.cnpj)
          .catch((err: Error) => {
            this.logger.error(`Gap ${gapId}: erro ao processar NSU=${rawDoc.nsu} — ${err.message}`);
            return null;
          });
        if (processado && !documentoId) documentoId = processado.id;
      }

      await this.prisma.dfeLote.update({
        where: { id: lote.id },
        data: { status: 'PROCESSADO', finalizadoEm: new Date() },
      });

      await this.prisma.dfeGapNsu.update({
        where: { id: gapId },
        data: {
          status: DfeGapStatus.RECUPERADO,
          recuperadoEm: new Date(),
          documentoId: documentoId ?? null,
        },
      });

      await this.nsuRepo.registrarAuditoria({
        tenantId,
        cnpj: gap.config.cnpj,
        operacao: 'GAP_RECUPERADO_MANUAL',
        nsuAntes: gap.nsuFaltante,
        cStat: ret.cStat,
        sucesso: true,
        detalhe: `Gap ${gapId} recuperado manualmente`,
        duracaoMs,
      });

      return { status: DfeGapStatus.RECUPERADO, cStat: ret.cStat };
    }

    if (ret.cStat === CSTAT.NENHUM_DOCUMENTO) {
      await this.prisma.dfeGapNsu.update({
        where: { id: gapId },
        data: { status: DfeGapStatus.INEXISTENTE },
      });

      await this.nsuRepo.registrarAuditoria({
        tenantId,
        cnpj: gap.config.cnpj,
        operacao: 'GAP_INEXISTENTE_MANUAL',
        nsuAntes: gap.nsuFaltante,
        cStat: ret.cStat,
        sucesso: true,
        detalhe: `NSU ${gap.nsuFaltante} inexistente no Ambiente Nacional`,
        duracaoMs,
      });

      return { status: DfeGapStatus.INEXISTENTE, cStat: ret.cStat };
    }

    // Qualquer outro cStat: incrementa tentativas
    const tentativas = gap.tentativas + 1;
    const novoStatus = tentativas >= 3 ? DfeGapStatus.ESGOTADO : DfeGapStatus.PENDENTE;

    await this.prisma.dfeGapNsu.update({
      where: { id: gapId },
      data: {
        tentativas,
        status: novoStatus,
        erroMensagem: `cStat=${ret.cStat} — ${ret.xMotivo}`,
        proximaTentativa:
          novoStatus === DfeGapStatus.PENDENTE
            ? new Date(Date.now() + Math.pow(2, tentativas) * 3_600_000)
            : null,
      },
    });

    return {
      status: novoStatus,
      cStat: ret.cStat,
      xMotivo: ret.xMotivo,
      tentativas,
    };
  }
}
