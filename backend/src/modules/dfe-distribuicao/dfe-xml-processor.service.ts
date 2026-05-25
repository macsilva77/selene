import { Injectable, Logger } from '@nestjs/common';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { PrismaService } from '../../database/prisma.service';
import { DfeStorageService } from './dfe-storage.service';
import { DfePubSubService } from './dfe-pubsub.service';
import { DfeDocumentoRaw, DfeDocumentoProcessado } from './dfe.types';

/** Descrição canônica por código de evento (NT 2013.005 / NT 2020.007) */
const DESCRICAO_EVENTO: Record<string, string> = {
  '110110': 'Carta de Correção',
  '110111': 'Cancelamento',
  '110112': 'Cancelamento por Substituição',
  '110140': 'EPEC',
  '110150': 'Manifestação do Fisco',
  '210200': 'Confirmação da Operação',
  '210210': 'Ciência da Operação',
  '210220': 'Desconhecimento da Operação',
  '210240': 'Operação não Realizada',
};

/**
 * Responsável por descompactar, identificar, parsear e persistir
 * cada documento DF-e recebido da SEFAZ.
 */
@Injectable()
export class DfeXmlProcessorService {
  private readonly logger = new Logger(DfeXmlProcessorService.name);

  // parseTagValue: false previne que fast-xml-parser converta a chave de acesso de 44 dígitos
  // para número de ponto flutuante (IEEE 754 double), o que causaria perda de precisão e
  // representação em notação científica. Campos numéricos (vNF etc.) são convertidos
  // explicitamente com Number.parseFloat() nos métodos de extração abaixo.
  private readonly xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: DfeStorageService,
    private readonly pubSub: DfePubSubService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────────
  // API pública
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Processa um documento raw recebido no lote SEFAZ.
   * Retorna `null` se o NSU já existia (idempotência).
   */
  async processarDocumento(
    raw: DfeDocumentoRaw,
    loteId: string,
    tenantId: string,
    cnpj: string,
  ): Promise<DfeDocumentoProcessado | null> {
    // 1. Descompactar
    const xmlBuffer = this.descompactar(raw.conteudoBase64GZip);
    const xmlHash = this.computarHash(xmlBuffer);
    const xmlString = xmlBuffer.toString('utf8');

    // 2. Identificar tipo
    const tipo = this.identificarTipo(raw.schema);

    // 3. Extrair campos
    const campos = this.extrairCampos(xmlString, tipo, raw.schema);

    // 4. Persistir (ignorar duplicatas via @@unique[tenantId, nsu])
    const docId = await this.persistirDocumento({
      loteId,
      tenantId,
      cnpjDestinatario: cnpj,
      nsu: raw.nsu,
      schema: raw.schema,
      tipo,
      xmlBuffer,
      xmlHash,
      campos,
    });

    if (docId === false) {
      this.logger.debug(`NSU ${raw.nsu} já existe para tenant ${tenantId} — ignorado`);
      return null;
    }

    // Aplicar etiqueta padrão ao documento recém criado
    try {
      const etiquetaPadrao = await this.prisma.etiqueta.findFirst({
        where: { tenantId, padrao: true, deletadoEm: null },
      });
      if (etiquetaPadrao) {
        await this.prisma.dfeDocumentoEtiqueta.createMany({
          data: [{ documentoId: docId, etiquetaId: etiquetaPadrao.id }],
          skipDuplicates: true,
        });
      }
    } catch (err) {
      this.logger.warn(`Falha ao aplicar etiqueta padrão ao doc ${docId}: ${(err as Error).message}`);
    }

    // Pub/Sub: emite nfe-recebida (fire-and-forget — falhas são logadas no serviço)
    await this.pubSub.publicarNfeRecebida({
      tenantId,
      cnpj,
      documentoId: docId,
      nsu: raw.nsu,
      tipoDocumento: tipo,
      chaveAcesso: campos.chaveAcesso,
    });

    return { id: docId, nsu: raw.nsu, schema: raw.schema, xmlBuffer, xmlHash, tipo, ...campos };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Descompactação e hash
  // ────────────────────────────────────────────────────────────────────────────

  private descompactar(base64Gzip: string): Buffer {
    const compressed = Buffer.from(base64Gzip, 'base64');
    try {
      return gunzipSync(compressed);
    } catch {
      // Pode vir não comprimido em resumes (resNFe, resEvento)
      return compressed;
    }
  }

  private computarHash(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Identificação do tipo
  // ────────────────────────────────────────────────────────────────────────────

  identificarTipo(schema: string): DfeDocumentoProcessado['tipo'] {
    if (schema.startsWith('procNFe')) return 'PROC_NFE';
    if (schema.startsWith('procEventoNFe')) return 'PROC_EVENTO_NFE';
    if (schema.startsWith('resNFe')) return 'RES_NFE';
    if (schema.startsWith('resEvento')) return 'RES_EVENTO';
    this.logger.warn(`Schema desconhecido: ${schema} — tratando como PROC_NFE`);
    return 'PROC_NFE';
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Extração de campos do XML
  // ────────────────────────────────────────────────────────────────────────────

  private extrairCampos(
    xml: string,
    tipo: DfeDocumentoProcessado['tipo'],
    schema: string,
  ): Partial<DfeDocumentoProcessado> {
    let parsed: any;
    try {
      parsed = this.xmlParser.parse(xml);
    } catch (err) {
      this.logger.warn(`Falha ao parsear XML (schema=${schema}): ${(err as Error).message}`);
      return {};
    }

    switch (tipo) {
      case 'PROC_NFE':
        return this.extrairProcNfe(parsed);
      case 'PROC_EVENTO_NFE':
        return this.extrairProcEvento(parsed);
      case 'RES_NFE':
        return this.extrairResNfe(parsed);
      case 'RES_EVENTO':
        return this.extrairResEvento(parsed);
      default:
        return {};
    }
  }

  private extrairProcNfe(parsed: any): Partial<DfeDocumentoProcessado> {
    try {
      const nfeProc = parsed?.nfeProc ?? parsed;
      const infNFe = nfeProc?.NFe?.infNFe ?? nfeProc?.infNFe;
      const ide = infNFe?.ide ?? {};
      const emit = infNFe?.emit ?? {};
      const total = infNFe?.total?.ICMSTot ?? {};
      const prot = nfeProc?.protNFe?.infProt ?? {};

      const chaveAcesso = String(infNFe?.['@_Id'] ?? '').replace('NFe', '');

      // Transportador: infNFe.transp.transporta.CNPJ
      const transp = infNFe?.transp?.transporta ?? {};
      const nfeTransportadorCnpj = String(transp.CNPJ ?? transp.CPF ?? '').replace(/\D/g, '') || undefined;

      // autXML: array de { CNPJ } ou { CPF } autorizados a obter o XML
      const autXmlRaw = infNFe?.autXML;
      const autXmlArr = Array.isArray(autXmlRaw) ? autXmlRaw : autXmlRaw ? [autXmlRaw] : [];
      const nfeAutXmlCnpjs = autXmlArr
        .map((a: any) => String(a?.CNPJ ?? a?.CPF ?? '').replace(/\D/g, ''))
        .filter(Boolean)
        .join(',') || undefined;

      const dest = infNFe?.dest ?? {};
      const nfeDestinatarioCnpj = String(dest.CNPJ ?? dest.CPF ?? '').replace(/\D/g, '') || undefined;

      return {
        chaveAcesso: chaveAcesso || undefined,
        nfeEmitenteCnpj: String(emit.CNPJ ?? emit.CPF ?? '').replace(/\D/g, '') || undefined,
        nfeEmitenteNome: String(emit.xNome ?? '') || undefined,
        nfeValorTotal: Number.parseFloat(String(total.vNF ?? '0')) || undefined,
        nfeDhEmissao: ide.dhEmi ? new Date(ide.dhEmi as string) : undefined,
        nfeSituacao: String(prot.cStat ?? '') || undefined,
        nfeTransportadorCnpj,
        nfeAutXmlCnpjs,
        nfeDestinatarioCnpj,
      };
    } catch (err) {
      this.logger.warn(`Falha ao extrair campos procNFe: ${(err as Error).message}`);
      return {};
    }
  }

  private extrairProcEvento(parsed: any): Partial<DfeDocumentoProcessado> {
    try {
      const proc = parsed?.procEventoNFe ?? parsed;
      const evento = proc?.evento ?? {};
      const infEvento = evento?.infEvento ?? {};
      const det = infEvento?.detEvento ?? {};
      const tpEvento = String(infEvento.tpEvento ?? '') || undefined;

      const descricaoXml = String(det.descEvento ?? '').trim() || undefined;
      const eventoDescricao = descricaoXml ?? (tpEvento ? DESCRICAO_EVENTO[tpEvento] : undefined);

      return {
        chaveAcesso: String(infEvento.chNFe ?? '') || undefined,
        nfeEmitenteCnpj: String(infEvento.CNPJ ?? infEvento.CPF ?? '').replace(/\D/g, '') || undefined,
        eventoTipo: tpEvento,
        eventoDescricao,
        nfeDhEmissao: infEvento.dhEvento ? new Date(infEvento.dhEvento as string) : undefined,
      };
    } catch (err) {
      this.logger.warn(`Falha ao extrair campos procEvento: ${(err as Error).message}`);
      return {};
    }
  }

  private extrairResNfe(parsed: any): Partial<DfeDocumentoProcessado> {
    try {
      const res = parsed?.resNFe ?? parsed;
      return {
        chaveAcesso: String(res.chNFe ?? '') || undefined,
        nfeEmitenteCnpj: String(res.CNPJ ?? res.CPF ?? '').replace(/\D/g, '') || undefined,
        nfeEmitenteNome: String(res.xNome ?? '') || undefined,
        nfeValorTotal: Number.parseFloat(String(res.vNF ?? '0')) || undefined,
        nfeDhEmissao: res.dhEmi ? new Date(res.dhEmi as string) : undefined,
        // cSitNFe: 1=Autorizada, 2=Cancelada (digVal é o hash SHA1 da assinatura — não é status)
        nfeSituacao: res.cSitNFe ? String(res.cSitNFe) : undefined,
      };
    } catch (err) {
      this.logger.warn(`Falha ao extrair campos resNFe: ${(err as Error).message}`);
      return {};
    }
  }

  private extrairResEvento(parsed: any): Partial<DfeDocumentoProcessado> {
    try {
      const res = parsed?.resEvento ?? parsed;
      const tpEvento = String(res.tpEvento ?? '') || undefined;

      const descricaoXml = String(res.xEvento ?? '').trim() || undefined;
      const eventoDescricao = descricaoXml ?? (tpEvento ? DESCRICAO_EVENTO[tpEvento] : undefined);

      return {
        chaveAcesso: String(res.chNFe ?? '') || undefined,
        nfeEmitenteCnpj: String(res.CNPJ ?? res.CPF ?? '').replace(/\D/g, '') || undefined,
        eventoTipo: tpEvento,
        eventoDescricao,
        nfeDhEmissao: res.dhEvento ? new Date(res.dhEvento as string) : undefined,
      };
    } catch (err) {
      this.logger.warn(`Falha ao extrair campos resEvento: ${(err as Error).message}`);
      return {};
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Persistência
  // ────────────────────────────────────────────────────────────────────────────

  private async persistirDocumento(params: {
    loteId: string;
    tenantId: string;
    cnpjDestinatario: string;
    nsu: string;
    schema: string;
    tipo: DfeDocumentoProcessado['tipo'];
    xmlBuffer: Buffer;
    xmlHash: string;
    campos: Partial<DfeDocumentoProcessado>;
  }): Promise<string | false> {
    // Upload para GCS se habilitado; senão mantém blob no banco
    let xmlOriginal: Buffer | null = params.xmlBuffer;
    let xmlStoragePath: string | null = null;

    if (this.storageService.isEnabled) {
      xmlStoragePath = this.storageService.xmlPath(
        params.tenantId,
        params.cnpjDestinatario,
        params.nsu,
      );
      await this.storageService.upload(xmlStoragePath, params.xmlBuffer);
      xmlOriginal = null;
    }

    try {
      const doc = await this.prisma.dfeDocumento.create({
        data: {
          loteId: params.loteId,
          tenantId: params.tenantId,
          cnpjDestinatario: params.cnpjDestinatario,
          nsu: params.nsu,
          schema: params.schema,
          tipoDocumento: params.tipo,
          xmlOriginal: xmlOriginal ?? undefined,
          xmlStoragePath,
          xmlHash: params.xmlHash,
          chaveAcesso: params.campos.chaveAcesso,
          nfeEmitenteCnpj: params.campos.nfeEmitenteCnpj,
          nfeEmitenteNome: params.campos.nfeEmitenteNome,
          nfeValorTotal: params.campos.nfeValorTotal,
          nfeDhEmissao: params.campos.nfeDhEmissao,
          nfeSituacao: params.campos.nfeSituacao,
          eventoTipo: params.campos.eventoTipo,
          eventoDescricao: params.campos.eventoDescricao,
          nfeTransportadorCnpj: params.campos.nfeTransportadorCnpj,
          nfeAutXmlCnpjs: params.campos.nfeAutXmlCnpjs,
          nfeDestinatarioCnpj: params.campos.nfeDestinatarioCnpj,
        },
        select: { id: true },
      });
      return doc.id;
    } catch (err: any) {
      // Código de erro do Postgres para violação de unique constraint
      if (err?.code === 'P2002') {
        return false; // NSU já existe — idempotência
      }
      throw err;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Backfill: popula nfeTransportadorCnpj e nfeAutXmlCnpjs nos docs existentes
  // ────────────────────────────────────────────────────────────────────────────

  async backfillTransportadorAutXml(tenantId?: string): Promise<{ processados: number; atualizados: number; erros: number }> {
    let processados = 0;
    let atualizados = 0;
    let erros = 0;
    const BATCH = 200;

    const where: any = {
      tipoDocumento: 'PROC_NFE',
      nfeTransportadorCnpj: null,
      nfeAutXmlCnpjs: null,
    };
    if (tenantId) where.tenantId = tenantId;

    // Conta total para log
    const total = await this.prisma.dfeDocumento.count({ where });
    this.logger.log(`Backfill transportador/autXML: ${total} documento(s) PROC_NFE a processar`);

    let cursor: string | undefined;

    for (;;) {
      const docs = await this.prisma.dfeDocumento.findMany({
        where,
        select: { id: true, schema: true, xmlOriginal: true, xmlStoragePath: true },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
      });

      if (docs.length === 0) break;
      cursor = docs[docs.length - 1].id;

      for (const doc of docs) {
        processados++;
        try {
          const xmlRaw = await this.storageService.resolverXml(doc);
          let xml: Buffer;
          try { xml = gunzipSync(xmlRaw); } catch { xml = xmlRaw; }

          const parsed = this.xmlParser.parse(xml.toString('utf8'));
          const campos = this.extrairProcNfe(parsed);

          if (!campos.nfeTransportadorCnpj && !campos.nfeAutXmlCnpjs) continue;

          await this.prisma.dfeDocumento.update({
            where: { id: doc.id },
            data: {
              nfeTransportadorCnpj: campos.nfeTransportadorCnpj ?? null,
              nfeAutXmlCnpjs: campos.nfeAutXmlCnpjs ?? null,
            },
          });
          atualizados++;
        } catch (err) {
          erros++;
          this.logger.warn(`Backfill erro doc ${doc.id}: ${(err as Error).message}`);
        }
      }

      this.logger.debug(`Backfill progresso: ${processados}/${total} (atualizados=${atualizados} erros=${erros})`);
    }

    this.logger.log(`Backfill concluído: processados=${processados} atualizados=${atualizados} erros=${erros}`);
    return { processados, atualizados, erros };
  }
}
