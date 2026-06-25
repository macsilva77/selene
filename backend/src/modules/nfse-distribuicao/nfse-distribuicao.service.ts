import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { NfseDistClientService } from './nfse-dist-client.service';
import { NfseCertLoaderService } from './nfse-cert-loader.service';
import { NfseNsuControlRepository } from './nfse-nsu-control.repository';
import { NfseXmlProcessorService } from './nfse-xml-processor.service';
import {
  baseUrlPadraoAdn,
  NfseCicloResumo,
  NFSE_DIST,
  NFSE_WORKER_DEFAULTS,
} from './nfse.types';
import { ConfigurarNfseDto } from './dto/configurar-nfse.dto';

/**
 * Orquestra a recepção de NFS-e pela distribuição do ADN.
 *
 * Ciclo (por CNPJ/config):
 *  1. adquire lock distribuído;
 *  2. carrega certificado (mTLS);
 *  3. consome lotes via GET /DFe/{ultNSU} (até 50 docs cada) enquanto houver;
 *  4. processa cada documento (parser + persistência idempotente);
 *  5. avança o cursor de NSU; ao esgotar (NENHUM_DOCUMENTO_LOCALIZADO),
 *     agenda a próxima consulta para daqui ≥ 1h (regra do manual).
 */
@Injectable()
export class NfseDistribuicaoService {
  private readonly logger = new Logger(NfseDistribuicaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: NfseDistClientService,
    private readonly certLoader: NfseCertLoaderService,
    private readonly controle: NfseNsuControlRepository,
    private readonly processor: NfseXmlProcessorService,
  ) {}

  /** Executa um ciclo completo de recepção para uma configuração. */
  async executarCiclo(configId: string): Promise<NfseCicloResumo> {
    const config = await this.prisma.nfseConfig.findUniqueOrThrow({ where: { id: configId } });
    const ctrl = await this.controle.obterOuCriarControle(configId, config.tenantId, config.cnpj);

    const lock = await this.controle.adquirirLock(ctrl.id);
    if (!lock.adquirido) {
      this.logger.debug(`Ciclo NFS-e ignorado (config=${configId}): ${lock.motivo}`);
      return {
        configId,
        lotesProcessados: 0,
        documentosBaixados: 0,
        ultimoNsu: ctrl.ultimoNsu,
        status: 'LOCK_NAO_ADQUIRIDO',
      };
    }

    let ultimoNsu = ctrl.ultimoNsu;
    let lotes = 0;
    let docs = 0;
    let statusFinal: NfseCicloResumo['status'] = 'NENHUM_DOCUMENTO_LOCALIZADO';
    let erro: string | undefined;
    let proximaConsulta: Date | null | undefined;

    try {
      const { pemCert, pemKey } = await this.certLoader.loadCert(config.certificadoId);

      for (let i = 0; i < NFSE_WORKER_DEFAULTS.maxCiclosPorExecucao; i++) {
        const res = await this.client.distribuirAPartirDeNsu(
          config.baseUrl,
          ultimoNsu,
          config.cnpj,
          pemCert,
          pemKey,
        );
        lotes++;
        statusFinal = res.status;

        if (res.status === 'REJEICAO') {
          erro = res.erros.join('; ') || 'Distribuição rejeitada pelo ADN';
          this.logger.warn(`Distribuição NFS-e rejeitada (config=${configId}): ${erro}`);
          // Backoff: não martelar o ADN após rejeição
          proximaConsulta = new Date(Date.now() + NFSE_DIST.INTERVALO_MIN_RECHECK_MS);
          break;
        }

        for (const item of res.itens) {
          try {
            const r = await this.processor.processarDocumento(item, config.tenantId, config.cnpj);
            if (r) docs++;
          } catch (err) {
            this.logger.warn(
              `Falha ao processar doc NFS-e (nsu=${item.nsu}, chave=${item.chaveAcesso}): ${(err as Error).message}`,
            );
          }
        }

        // Avança o cursor se o ADN informou um NSU maior
        if (res.ultimoNsu && BigInt(res.ultimoNsu) > BigInt(ultimoNsu)) {
          ultimoNsu = res.ultimoNsu;
        }

        // Esgotou (sem novos documentos) → respeita o intervalo mínimo de 1h
        if (res.status === 'NENHUM_DOCUMENTO_LOCALIZADO' || res.itens.length === 0) {
          proximaConsulta = new Date(Date.now() + NFSE_DIST.INTERVALO_MIN_RECHECK_MS);
          break;
        }
      }
    } catch (err) {
      erro = (err as Error).message;
      statusFinal = 'ERRO';
      this.logger.error(`Erro no ciclo NFS-e (config=${configId}): ${erro}`);
      // Backoff antes de nova tentativa: 1h para rate limit (429) / consumo indevido,
      // 15 min para os demais erros — evita martelar o ADN a cada ciclo do cron.
      const backoffMs = /\b429\b/.test(erro) ? NFSE_DIST.INTERVALO_MIN_RECHECK_MS : 15 * 60 * 1000;
      proximaConsulta = new Date(Date.now() + backoffMs);
    } finally {
      await this.controle.liberarLockEAtualizar(ctrl.id, lock.lockId, {
        ultimoNsu,
        docsBaixados: docs,
        proximaConsulta,
        erro,
      });
    }

    this.logger.log(
      `Ciclo NFS-e concluído (config=${configId}): lotes=${lotes} docs=${docs} ultNSU=${ultimoNsu} status=${statusFinal}`,
    );
    return { configId, lotesProcessados: lotes, documentosBaixados: docs, ultimoNsu, status: statusFinal, erro };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Gestão de configuração
  // ────────────────────────────────────────────────────────────────────────────

  /** Cria/atualiza a configuração de recepção para um CNPJ. */
  async configurar(tenantId: string, usuarioId: string, dto: ConfigurarNfseDto) {
    // CNPJ deve estar cadastrado em Empresas do tenant
    const empresa = await this.prisma.empresa.findFirst({
      where: { tenantId, cnpj: dto.cnpj },
      select: { id: true },
    });
    if (!empresa) {
      throw new BadRequestException(`CNPJ ${dto.cnpj} não está cadastrado em Empresas.`);
    }

    // Certificado deve existir e pertencer ao tenant
    const cert = await this.prisma.certificadoDigital.findFirst({
      where: { id: dto.certificadoId, tenantId },
      select: { id: true },
    });
    if (!cert) {
      throw new BadRequestException('Certificado não encontrado para este tenant.');
    }

    const baseUrl = dto.baseUrl ?? baseUrlPadraoAdn(dto.tpAmb);

    return this.prisma.nfseConfig.upsert({
      where: { tenantId_cnpj: { tenantId, cnpj: dto.cnpj } },
      create: {
        tenantId,
        cnpj: dto.cnpj,
        tpAmb: dto.tpAmb,
        baseUrl,
        certificadoId: dto.certificadoId,
        horarioCaptura: dto.horarioCaptura ?? '00:00',
        intervaloMinutos: dto.intervaloMinutos ?? 60,
        criadoPorId: usuarioId,
      },
      update: {
        tpAmb: dto.tpAmb,
        baseUrl,
        certificadoId: dto.certificadoId,
        ...(dto.horarioCaptura ? { horarioCaptura: dto.horarioCaptura } : {}),
        ...(dto.intervaloMinutos ? { intervaloMinutos: dto.intervaloMinutos } : {}),
      },
    });
  }

  /** Lista as configurações do tenant com estatísticas de NSU. */
  async listarStatus(tenantId: string) {
    return this.prisma.nfseConfig.findMany({
      where: { tenantId },
      include: { controle: true },
      orderBy: { criadoEm: 'asc' },
    });
  }

  /** Ativa/desativa uma configuração. */
  async definirAtivo(tenantId: string, id: string, ativo: boolean) {
    const config = await this.prisma.nfseConfig.findFirst({ where: { id, tenantId } });
    if (!config) throw new NotFoundException('Configuração NFS-e não encontrada.');
    return this.prisma.nfseConfig.update({ where: { id }, data: { ativo } });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Consulta de documentos recebidos
  // ────────────────────────────────────────────────────────────────────────────

  /** Lista NFS-e recebidas, paginadas e filtradas. */
  async listarDocumentos(
    tenantId: string,
    filtros: {
      page?: number;
      limit?: number;
      cnpj?: string;
      papel?: string;
      prestadorDoc?: string;
      tomadorDoc?: string;
      chaveAcesso?: string;
      competenciaInicio?: string;
      competenciaFim?: string;
      cancelada?: boolean;
    },
  ) {
    const page = Math.max(1, filtros.page ?? 1);
    const limit = Math.min(200, Math.max(1, filtros.limit ?? 50));

    const where: Prisma.NfseDocumentoWhereInput = {
      tenantId,
      ...(filtros.cnpj ? { cnpjTitular: filtros.cnpj } : {}),
      ...(filtros.papel ? { papelTitular: filtros.papel as Prisma.EnumNfsePapelTitularFilter['equals'] } : {}),
      ...(filtros.prestadorDoc ? { prestadorDoc: filtros.prestadorDoc } : {}),
      ...(filtros.tomadorDoc ? { tomadorDoc: filtros.tomadorDoc } : {}),
      ...(filtros.chaveAcesso ? { chaveAcesso: filtros.chaveAcesso } : {}),
      ...(filtros.cancelada !== undefined ? { cancelada: filtros.cancelada } : {}),
      ...(filtros.competenciaInicio || filtros.competenciaFim
        ? {
            competencia: {
              ...(filtros.competenciaInicio ? { gte: new Date(filtros.competenciaInicio) } : {}),
              ...(filtros.competenciaFim ? { lte: new Date(filtros.competenciaFim) } : {}),
            },
          }
        : {}),
    };

    const [total, itens] = await this.prisma.$transaction([
      this.prisma.nfseDocumento.count({ where }),
      this.prisma.nfseDocumento.findMany({
        where,
        orderBy: { dhProcessamento: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        // não traz o XML na listagem
        select: {
          id: true, chaveAcesso: true, numero: true, papelTitular: true, cnpjTitular: true,
          competencia: true, dhProcessamento: true, codMunIncidencia: true,
          prestadorDoc: true, prestadorNome: true, tomadorDoc: true, tomadorNome: true,
          codTribNac: true, descricaoServico: true, valorServico: true, valorIssqn: true,
          valorLiquido: true, tribIssqn: true, tpRetIssqn: true, cancelada: true,
        },
      }),
    ]);

    return { total, page, limit, itens };
  }

  /** Baixa o PDF do DANFSe de uma NFS-e recebida, via ADN (mTLS). */
  async baixarDanfse(tenantId: string, id: string): Promise<{ pdf: Buffer; nomeArquivo: string }> {
    const doc = await this.prisma.nfseDocumento.findFirst({
      where: { id, tenantId },
      select: { chaveAcesso: true, cnpjTitular: true },
    });
    if (!doc) throw new NotFoundException('NFS-e não encontrada.');

    const config = await this.prisma.nfseConfig.findFirst({
      where: { tenantId, cnpj: doc.cnpjTitular },
      select: { baseUrl: true, certificadoId: true },
    });
    if (!config) {
      throw new BadRequestException(
        `Sem configuração NFS-e para o CNPJ ${doc.cnpjTitular} — necessária para autenticar no ADN.`,
      );
    }

    const { pemCert, pemKey } = await this.certLoader.loadCert(config.certificadoId);
    const pdf = await this.client.baixarDanfse(config.baseUrl, doc.chaveAcesso, pemCert, pemKey);
    return { pdf, nomeArquivo: `danfse-${doc.chaveAcesso}.pdf` };
  }

  /** Detalhe de uma NFS-e (inclui XML decodificado e eventos). */
  async obterDocumento(tenantId: string, id: string) {
    const doc = await this.prisma.nfseDocumento.findFirst({
      where: { id, tenantId },
      include: { eventos: { orderBy: { dhProcessamento: 'asc' } } },
    });
    if (!doc) throw new NotFoundException('NFS-e não encontrada.');

    const { xmlOriginal, ...resto } = doc;
    return { ...resto, xml: xmlOriginal ? xmlOriginal.toString('utf8') : null };
  }

  /** Executa o ciclo para todas as configs ativas cuja proximaConsulta já venceu. */
  async executarPendentes(): Promise<NfseCicloResumo[]> {
    const agora = new Date();
    const configs = await this.prisma.nfseConfig.findMany({
      where: {
        ativo: true,
        OR: [
          { controle: null },
          { controle: { proximaConsulta: null } },
          { controle: { proximaConsulta: { lte: agora } } },
        ],
      },
      select: { id: true },
    });

    const resumos: NfseCicloResumo[] = [];
    for (const c of configs) {
      resumos.push(await this.executarCiclo(c.id));
    }
    return resumos;
  }
}
