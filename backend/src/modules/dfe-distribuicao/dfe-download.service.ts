import { Injectable, Logger } from '@nestjs/common';
import { DfeManifestacaoStatus, DfeTipoDocumento, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { DfeCertLoaderService } from './dfe-cert-loader.service';
import { DfeSoapClientService } from './dfe-soap-client.service';
import { DfeXmlProcessorService } from './dfe-xml-processor.service';
import { CSTAT } from './dfe.types';

/**
 * Serviço responsável pelo download do XML completo (procNFe) após a emissão
 * da Ciência da Operação (tpEvento=210210).
 *
 * Fluxo:
 *  1. Busca documentos RES_NFE que possuem Ciência ENVIADO e ainda não têm
 *     um PROC_NFE correspondente para a mesma chave de acesso.
 *  2. Para cada documento pendente, chama `consChNFe` no WS NFeDistribuicaoDFe.
 *  3. cStat=138 → cria DfeLote de download + processa cada doc via DfeXmlProcessorService.
 *  4. Falhas permanentes (fora do prazo, sem permissão, etc.) → marca o documento
 *     de origem com `erroProcessamento` para evitar retentativas infinitas.
 *  5. Falhas transientes → nenhuma marcação, o documento é retentado no próximo ciclo.
 *
 * Referência: MOC 7.0 seção 5.7.4.6 (consChNFe).
 */
@Injectable()
export class DfeDownloadService {
  private readonly logger = new Logger(DfeDownloadService.name);

  /**
   * Quantidade máxima de documentos processados por ciclo.
   * Mantido pequeno para não sobrecarregar a SEFAZ nem o banco.
   */
  private readonly DOCS_POR_CICLO = 10;

  /**
   * cStats da SEFAZ que indicam falha permanente e irreversível.
   * Documentos com esses retornos não serão retentados.
   */
  private readonly CSTATS_PERMANENTES = new Set<string>([
    CSTAT.NFE_FORA_PRAZO,        // 632 — mais de 90 dias
    CSTAT.SEM_PERMISSAO_NFE,     // 640 — CNPJ não é destinatário/transportador
    CSTAT.NFE_INDISPONIVEL_EMITENTE, // 641
    CSTAT.NFE_CANCELADA,         // 653 — arquivo indisponível por cancelamento
    CSTAT.NFE_DENEGADA,          // 654 — arquivo indisponível por denegação
    CSTAT.NFE_INEXISTENTE,       // 217 — chave não encontrada
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly certLoader: DfeCertLoaderService,
    private readonly soapClient: DfeSoapClientService,
    private readonly xmlProcessor: DfeXmlProcessorService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────────
  // API pública — chamada pelo DfeDownloadJob
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Processa todos os RES_NFE pendentes de download neste ciclo.
   * Limitado a `DOCS_POR_CICLO` por execução para evitar sobrecarga.
   */
  async processarPendentes(filtro?: { tenantId?: string; cnpj?: string }): Promise<void> {
    const pendentes = await this.buscarPendentes(filtro);

    if (pendentes.length === 0) {
      this.logger.debug('Nenhum RES_NFE pendente de download.');
      return;
    }

    this.logger.log(`${pendentes.length} RES_NFE(s) pendente(s) de download — processando...`);

    let sucessos = 0;
    let falhasPermanentes = 0;
    let falhastransientes = 0;

    for (const doc of pendentes) {
      const resultado = await this.baixarDocumento(doc).catch((err: Error) => {
        this.logger.error(`Falha inesperada ao baixar doc ${doc.id}: ${err.message}`, err.stack);
        return 'ERRO_TRANSIENTE' as const;
      });

      if (resultado === 'OK') sucessos++;
      else if (resultado === 'FALHA_PERMANENTE') falhasPermanentes++;
      else falhastransientes++;
    }

    this.logger.log(
      `Download concluído — ok=${sucessos} permanentes=${falhasPermanentes} transientes=${falhastransientes}`,
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Busca de pendentes
  // ────────────────────────────────────────────────────────────────────────────

  private async buscarPendentes(filtro?: { tenantId?: string; cnpj?: string }) {
    const where: Prisma.DfeDocumentoWhereInput = {
      tipoDocumento: DfeTipoDocumento.RES_NFE,
      chaveAcesso: { not: null },
      erroProcessamento: null,
      manifestacoes: {
        some: {
          tpEvento: '210210',
          status: DfeManifestacaoStatus.ENVIADO,
        },
      },
    };
    if (filtro?.tenantId) where.tenantId = filtro.tenantId;
    if (filtro?.cnpj) where.cnpjDestinatario = filtro.cnpj;

    // Passo 1: RES_NFE com Ciência ENVIADO, sem erro permanente marcado
    const candidatos = await this.prisma.dfeDocumento.findMany({
      where,
      select: {
        id: true,
        tenantId: true,
        chaveAcesso: true,
        cnpjDestinatario: true,
        nsu: true,
      },
      orderBy: { criadoEm: 'asc' },
      take: this.DOCS_POR_CICLO * 2, // busca 2× e filtra, para cobrir os já baixados
    });

    if (candidatos.length === 0) return [];

    // Passo 2: Exclui os que já possuem PROC_NFE com a mesma chave/tenant
    const chaves = candidatos.map((d) => d.chaveAcesso!);
    const jaDownloaded = await this.prisma.dfeDocumento.findMany({
      where: {
        tipoDocumento: DfeTipoDocumento.PROC_NFE,
        chaveAcesso: { in: chaves },
      },
      select: { tenantId: true, chaveAcesso: true },
    });

    const jaSet = new Set(jaDownloaded.map((d) => `${d.tenantId}:${d.chaveAcesso}`));

    return candidatos
      .filter((d) => !jaSet.has(`${d.tenantId}:${d.chaveAcesso}`))
      .slice(0, this.DOCS_POR_CICLO);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Download individual
  // ────────────────────────────────────────────────────────────────────────────

  /** Ponto de entrada para o DfeDownloadWorker — processa um documento específico por ID. */
  async executarDownload(params: {
    documentoId: string;
    tenantId: string;
    chaveAcesso: string;
    cnpj: string;
    nsu: string;
  }): Promise<'OK' | 'FALHA_PERMANENTE' | 'ERRO_TRANSIENTE'> {
    return this.baixarDocumento({
      id: params.documentoId,
      tenantId: params.tenantId,
      chaveAcesso: params.chaveAcesso,
      cnpjDestinatario: params.cnpj,
      nsu: params.nsu,
    });
  }

  private async baixarDocumento(doc: {
    id: string;
    tenantId: string;
    chaveAcesso: string | null;
    cnpjDestinatario: string;
    nsu: string;
  }): Promise<'OK' | 'FALHA_PERMANENTE' | 'ERRO_TRANSIENTE'> {
    if (!doc.chaveAcesso) return 'ERRO_TRANSIENTE';

    // Encontra configuração DFe ativa para o CNPJ destinatário
    const config = await this.prisma.dfeConfig.findFirst({
      where: { tenantId: doc.tenantId, cnpj: doc.cnpjDestinatario, ativo: true },
      select: { id: true, cnpj: true, cUf: true, tpAmb: true },
    });

    if (!config) {
      this.logger.warn(
        `Sem DfeConfig ativa para CNPJ ${doc.cnpjDestinatario} (tenant ${doc.tenantId}) — doc ${doc.id} ignorado`,
      );
      return 'ERRO_TRANSIENTE';
    }

    let pemCert: string;
    let pemKey: string;

    try {
      const cert = await this.certLoader.loadCert(doc.tenantId, config.id);
      pemCert = cert.pemCert;
      pemKey = cert.pemKey;
    } catch (err) {
      this.logger.error(
        `Doc ${doc.id}: falha ao carregar certificado — ${(err as Error).message}`,
      );
      return 'ERRO_TRANSIENTE';
    }

    const inicio = Date.now();

    let ret: Awaited<ReturnType<typeof this.soapClient.consultarChNFe>>;
    try {
      ret = await this.soapClient.consultarChNFe(
        {
          cnpj: config.cnpj,
          cUf: config.cUf,
          tpAmb: config.tpAmb as 1 | 2,
          chNFe: doc.chaveAcesso,
        },
        pemCert,
        pemKey,
      );
    } catch (err) {
      this.logger.error(
        `Doc ${doc.id}: falha SOAP consChNFe — ${(err as Error).message}`,
      );
      return 'ERRO_TRANSIENTE';
    }

    const duracaoMs = Date.now() - inicio;

    // Falha permanente — marca o documento para não retentar
    if (this.CSTATS_PERMANENTES.has(ret.cStat)) {
      this.logger.warn(
        `Doc ${doc.id} (chave ${doc.chaveAcesso}): download indisponível — cStat=${ret.cStat} ${ret.xMotivo}`,
      );
      await this.prisma.dfeDocumento.update({
        where: { id: doc.id },
        data: {
          erroProcessamento: `DOWNLOAD_INDISPONIVEL: cStat=${ret.cStat} — ${ret.xMotivo}`,
        },
      });
      return 'FALHA_PERMANENTE';
    }

    // Falha transiente — qualquer cStat que não seja 138
    if (ret.cStat !== CSTAT.DOCUMENTOS_LOCALIZADOS) {
      this.logger.warn(
        `Doc ${doc.id}: consChNFe retornou cStat=${ret.cStat} — retentará no próximo ciclo`,
      );
      return 'ERRO_TRANSIENTE';
    }

    // ── cStat=138: cria lote e processa documentos ────────────────────────────
    const controle = await this.prisma.dfeNsuControle.findUnique({
      where: { configId: config.id },
      select: { id: true },
    });

    const lote = await this.prisma.dfeLote.create({
      data: {
        controleId: controle?.id ?? '',
        tenantId: doc.tenantId,
        cnpj: config.cnpj,
        nsuEnviado: doc.nsu, // NSU do RES_NFE de origem como rastreabilidade
        cStat: ret.cStat,
        xMotivo: ret.xMotivo,
        ultNsuRecebido: ret.ultNSU,
        maxNsuRecebido: ret.maxNSU,
        qtdDocumentos: ret.documentos.length,
        status: 'PROCESSANDO',
        duracaoMs,
      },
    });

    let processados = 0;
    for (const rawDoc of ret.documentos) {
      try {
        const result = await this.xmlProcessor.processarDocumento(
          rawDoc,
          lote.id,
          doc.tenantId,
          config.cnpj,
        );
        if (result) processados++;
      } catch (err) {
        this.logger.error(
          `Lote ${lote.id}: erro ao processar NSU=${rawDoc.nsu} — ${(err as Error).message}`,
        );
      }
    }

    await this.prisma.dfeLote.update({
      where: { id: lote.id },
      data: {
        status: 'PROCESSADO',
        finalizadoEm: new Date(),
        qtdDocumentos: processados,
      },
    });

    this.logger.log(
      `Download OK — chave=${doc.chaveAcesso} processados=${processados}/${ret.documentos.length}`,
    );

    return 'OK';
  }
}
