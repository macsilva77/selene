import { Injectable, Logger } from '@nestjs/common';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { PrismaService } from '../../database/prisma.service';
import { CteStorageService } from './cte-storage.service';
import { CtePubSubService } from './cte-pubsub.service';
import { CteDocumentoRaw, CteDocumentoProcessado, CteTipo } from './cte.types';

/** Descrição canônica por código de evento do CT-e */
const DESCRICAO_EVENTO_CTE: Record<string, string> = {
  '110110': 'Carta de Correção',
  '110111': 'Cancelamento',
  '110113': 'EPEC',
  '110140': 'EPEC',
  '110160': 'Registro Multimodal',
  '110170': 'Informações da GTV',
  '110180': 'Comprovante de Entrega do CT-e',
  '110181': 'Cancelamento do Comprovante de Entrega',
  '310610': 'Insucesso na Entrega do CT-e',
  '310620': 'Cancelamento do Insucesso na Entrega',
  '610110': 'Prestação do Serviço em Desacordo',
  '610111': 'Cancelamento da Prestação do Serviço em Desacordo',
};

/**
 * Descompacta, identifica, parseia e persiste cada documento do CT-e recebido
 * na distribuição. Suporta CT-e (57), CT-e OS (67) e GTV-e (64) de forma
 * defensiva — o tipo é identificado pelo prefixo do schema e o modelo pelo XML.
 */
@Injectable()
export class CteXmlProcessorService {
  private readonly logger = new Logger(CteXmlProcessorService.name);

  // parseTagValue: false evita que a chave de acesso (44 dígitos) vire float.
  private readonly xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: CteStorageService,
    private readonly pubSub: CtePubSubService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────────
  // API pública
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Processa um documento raw recebido no lote SEFAZ.
   * Retorna `null` se o NSU já existia (idempotência).
   */
  async processarDocumento(
    raw: CteDocumentoRaw,
    loteId: string,
    tenantId: string,
    cnpjInteressado: string,
  ): Promise<CteDocumentoProcessado | null> {
    const xmlBuffer = this.descompactar(raw.conteudoBase64GZip);
    const xmlHash = this.computarHash(xmlBuffer);
    const xmlString = xmlBuffer.toString('utf8');

    const tipo = this.identificarTipo(raw.schema);
    const campos = this.extrairCampos(xmlString, tipo, raw.schema);

    const docId = await this.persistirDocumento({
      loteId,
      tenantId,
      cnpjInteressado,
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

    // Etiqueta padrão do tenant (reusa o model Etiqueta genérico)
    try {
      const etiquetaPadrao = await this.prisma.etiqueta.findFirst({
        where: { tenantId, padrao: true, deletadoEm: null },
      });
      if (etiquetaPadrao) {
        await this.prisma.cteDocumentoEtiqueta.createMany({
          data: [{ documentoId: docId, etiquetaId: etiquetaPadrao.id }],
          skipDuplicates: true,
        });
      }
    } catch (err) {
      this.logger.warn(`Falha ao aplicar etiqueta padrão ao doc ${docId}: ${(err as Error).message}`);
    }

    await this.pubSub.publicarCteRecebido({
      tenantId,
      cnpj: cnpjInteressado,
      documentoId: docId,
      nsu: raw.nsu,
      tipoDocumento: tipo,
      modelo: campos.modelo ?? null,
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
      return compressed;
    }
  }

  private computarHash(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Identificação do tipo (pelo PREFIXO do schema — robusto a versões)
  // ────────────────────────────────────────────────────────────────────────────

  identificarTipo(schema: string): CteTipo {
    if (schema.startsWith('procEventoCTe')) return 'PROC_EVENTO_CTE';
    if (schema.startsWith('resEventoCTe')) return 'RES_EVENTO_CTE';
    if (schema.startsWith('resCTe')) return 'RES_CTE';
    if (schema.startsWith('procCTe')) return 'PROC_CTE';
    // procCTeOS, procGTVe e variantes caem aqui como documento completo
    if (schema.startsWith('proc')) return 'PROC_CTE';
    this.logger.warn(`Schema desconhecido: ${schema} — tratando como PROC_CTE`);
    return 'PROC_CTE';
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Extração de campos do XML
  // ────────────────────────────────────────────────────────────────────────────

  private extrairCampos(xml: string, tipo: CteTipo, schema: string): Partial<CteDocumentoProcessado> {
    let parsed: any;
    try {
      parsed = this.xmlParser.parse(xml);
    } catch (err) {
      this.logger.warn(`Falha ao parsear XML (schema=${schema}): ${(err as Error).message}`);
      return {};
    }

    switch (tipo) {
      case 'PROC_CTE':
        return this.extrairProcCte(parsed);
      case 'PROC_EVENTO_CTE':
        return this.extrairProcEventoCte(parsed);
      case 'RES_CTE':
        return this.extrairResCte(parsed);
      case 'RES_EVENTO_CTE':
        return this.extrairResEventoCte(parsed);
      default:
        return {};
    }
  }

  /** CNPJ ou CPF de um grupo de participante, só dígitos. */
  private docDe(part: any): string | undefined {
    if (!part) return undefined;
    return String(part.CNPJ ?? part.CPF ?? '').replace(/\D/g, '') || undefined;
  }

  /** Nome/razão social (xNome) de um grupo de participante. */
  private nomeDe(part: any): string | undefined {
    if (!part) return undefined;
    return String(part.xNome ?? '').trim() || undefined;
  }

  /** Converte para número preservando 0; ausente/vazio/NaN → undefined. */
  private numOrUndef(v: unknown): number | undefined {
    if (v === null || v === undefined || v === '') return undefined;
    const n = Number.parseFloat(String(v));
    return Number.isFinite(n) ? n : undefined;
  }

  private extrairProcCte(parsed: any): Partial<CteDocumentoProcessado> {
    try {
      // Cobre CT-e (cteProc/CTe), CT-e OS (cteOSProc/CTeOS) e variantes.
      const proc = parsed?.cteProc ?? parsed?.cteOSProc ?? parsed?.CTeOSProc ?? parsed;
      const docRoot = proc?.CTe ?? proc?.CTeOS ?? proc?.GTVe ?? proc;
      const infCte = docRoot?.infCte ?? proc?.infCte ?? {};
      const ide = infCte?.ide ?? {};
      const emit = infCte?.emit ?? {};
      const rem = infCte?.rem ?? {};
      const dest = infCte?.dest ?? {};
      const exped = infCte?.exped ?? {};
      const receb = infCte?.receb ?? {};
      const vPrest = infCte?.vPrest ?? {};
      const prot = proc?.protCTe?.infProt ?? {};

      const chaveAcesso = String(infCte?.['@_Id'] ?? '').replace(/^CTe/, '') || undefined;
      const modelo = Number.parseInt(String(ide.mod ?? ''), 10) || undefined;

      // Tomador: toma4 (terceiro, com CNPJ/CPF próprio) tem prioridade; senão
      // toma3.toma (0=rem,1=exped,2=receb,3=dest) aponta para o participante.
      const cteTomadorCnpj = this.resolverTomador(ide, { rem, exped, receb, dest });

      return {
        chaveAcesso,
        modelo,
        cteEmitenteCnpj: this.docDe(emit),
        cteEmitenteNome: this.nomeDe(emit),
        cteValorPrestacao: this.numOrUndef(vPrest.vTPrest),
        cteValorReceber: this.numOrUndef(vPrest.vRec),
        cteDhEmissao: ide.dhEmi ? new Date(String(ide.dhEmi)) : undefined,
        cteSituacao: String(prot.cStat ?? '') || undefined,
        tpCte: ide.tpCTe !== undefined ? Number.parseInt(String(ide.tpCTe), 10) : undefined,
        cfop: String(ide.CFOP ?? '') || undefined,
        modal: String(ide.modal ?? '') || undefined,
        ufIni: String(ide.UFIni ?? '') || undefined,
        ufFim: String(ide.UFFim ?? '') || undefined,
        cteTomadorCnpj,
        cteRemetenteCnpj: this.docDe(rem),
        cteDestinatarioCnpj: this.docDe(dest),
        cteExpedidorCnpj: this.docDe(exped),
        cteRecebedorCnpj: this.docDe(receb),
        cteTomadorNome: this.resolverTomadorNome(ide, { rem, exped, receb, dest }),
        cteRemetenteNome: this.nomeDe(rem),
        cteDestinatarioNome: this.nomeDe(dest),
        cteExpedidorNome: this.nomeDe(exped),
        cteRecebedorNome: this.nomeDe(receb),
        cteChavesNfe: this.extrairChavesNfe(infCte),
      };
    } catch (err) {
      this.logger.warn(`Falha ao extrair campos procCTe: ${(err as Error).message}`);
      return {};
    }
  }

  /** Resolve o CNPJ/CPF do tomador a partir de ide.toma3/toma4. */
  private resolverTomador(
    ide: any,
    partes: { rem: any; exped: any; receb: any; dest: any },
  ): string | undefined {
    // toma4: tomador é um terceiro com identificação própria
    if (ide?.toma4) return this.docDe(ide.toma4);
    // CT-e OS: ide.toma direto. CT-e: ide.toma3.toma
    const tomaVal = ide?.toma3?.toma ?? ide?.toma3 ?? ide?.toma;
    switch (String(tomaVal)) {
      case '0':
        return this.docDe(partes.rem);
      case '1':
        return this.docDe(partes.exped);
      case '2':
        return this.docDe(partes.receb);
      case '3':
        return this.docDe(partes.dest);
      default:
        return undefined;
    }
  }

  /** Resolve o nome do tomador a partir de ide.toma3/toma4 (mesma lógica de resolverTomador). */
  private resolverTomadorNome(
    ide: any,
    partes: { rem: any; exped: any; receb: any; dest: any },
  ): string | undefined {
    if (ide?.toma4) return this.nomeDe(ide.toma4);
    const tomaVal = ide?.toma3?.toma ?? ide?.toma3 ?? ide?.toma;
    switch (String(tomaVal)) {
      case '0':
        return this.nomeDe(partes.rem);
      case '1':
        return this.nomeDe(partes.exped);
      case '2':
        return this.nomeDe(partes.receb);
      case '3':
        return this.nomeDe(partes.dest);
      default:
        return undefined;
    }
  }

  /** Chaves das NF-e transportadas (infCTeNorm/infDoc/infNFe — 4.00; fallback 3.00). */
  private extrairChavesNfe(infCte: any): string | undefined {
    const norm = infCte?.infCTeNorm ?? infCte?.infCteNorm ?? {};
    const infDoc = norm?.infDoc ?? norm;
    const raw = infDoc?.infNFe ?? norm?.infNFe;
    const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const chaves = arr
      .map((n: any) => String(n?.chave ?? n?.chNFe ?? '').replace(/\D/g, ''))
      .filter((c: string) => c.length === 44);
    return chaves.length ? chaves.join(',') : undefined;
  }

  private extrairProcEventoCte(parsed: any): Partial<CteDocumentoProcessado> {
    try {
      const proc = parsed?.procEventoCTe ?? parsed;
      const evento = proc?.eventoCTe ?? proc?.evento ?? {};
      const infEvento = evento?.infEvento ?? {};
      const det = infEvento?.detEvento ?? {};
      const tpEvento = String(infEvento.tpEvento ?? '') || undefined;
      const descricaoXml = String(det.descEvento ?? '').trim() || undefined;

      return {
        chaveAcesso: String(infEvento.chCTe ?? '') || undefined,
        cteEmitenteCnpj: this.docDe(infEvento),
        eventoTipo: tpEvento,
        eventoDescricao: descricaoXml ?? (tpEvento ? DESCRICAO_EVENTO_CTE[tpEvento] : undefined),
        cteDhEmissao: infEvento.dhEvento ? new Date(String(infEvento.dhEvento)) : undefined,
      };
    } catch (err) {
      this.logger.warn(`Falha ao extrair campos procEventoCTe: ${(err as Error).message}`);
      return {};
    }
  }

  private extrairResCte(parsed: any): Partial<CteDocumentoProcessado> {
    try {
      const res = parsed?.resCTe ?? parsed;
      return {
        chaveAcesso: String(res.chCTe ?? '') || undefined,
        cteEmitenteCnpj: this.docDe(res),
        cteEmitenteNome: String(res.xNome ?? '') || undefined,
        cteValorPrestacao: this.numOrUndef(res.vTPrest),
        cteDhEmissao: res.dhEmi ? new Date(String(res.dhEmi)) : undefined,
        cteSituacao: res.cSitCTe ? String(res.cSitCTe) : undefined,
        modal: String(res.modal ?? '') || undefined,
        tpCte: res.tpCTe !== undefined ? Number.parseInt(String(res.tpCTe), 10) : undefined,
      };
    } catch (err) {
      this.logger.warn(`Falha ao extrair campos resCTe: ${(err as Error).message}`);
      return {};
    }
  }

  private extrairResEventoCte(parsed: any): Partial<CteDocumentoProcessado> {
    try {
      const res = parsed?.resEventoCTe ?? parsed;
      const tpEvento = String(res.tpEvento ?? '') || undefined;
      const descricaoXml = String(res.xEvento ?? '').trim() || undefined;

      return {
        chaveAcesso: String(res.chCTe ?? '') || undefined,
        cteEmitenteCnpj: this.docDe(res),
        eventoTipo: tpEvento,
        eventoDescricao: descricaoXml ?? (tpEvento ? DESCRICAO_EVENTO_CTE[tpEvento] : undefined),
        cteDhEmissao: res.dhEvento ? new Date(String(res.dhEvento)) : undefined,
      };
    } catch (err) {
      this.logger.warn(`Falha ao extrair campos resEventoCTe: ${(err as Error).message}`);
      return {};
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Persistência
  // ────────────────────────────────────────────────────────────────────────────

  private async persistirDocumento(params: {
    loteId: string;
    tenantId: string;
    cnpjInteressado: string;
    nsu: string;
    schema: string;
    tipo: CteTipo;
    xmlBuffer: Buffer;
    xmlHash: string;
    campos: Partial<CteDocumentoProcessado>;
  }): Promise<string | false> {
    let xmlOriginal: Buffer | null = params.xmlBuffer;
    let xmlStoragePath: string | null = null;

    if (this.storageService.isEnabled) {
      xmlStoragePath = this.storageService.xmlPath(
        params.tenantId,
        params.cnpjInteressado,
        params.nsu,
      );
      await this.storageService.upload(xmlStoragePath, params.xmlBuffer);
      xmlOriginal = null;
    }

    try {
      const doc = await this.prisma.cteDocumento.create({
        data: {
          loteId: params.loteId,
          tenantId: params.tenantId,
          cnpjInteressado: params.cnpjInteressado,
          nsu: params.nsu,
          schema: params.schema,
          tipoDocumento: params.tipo,
          modelo: params.campos.modelo ?? null,
          xmlOriginal: xmlOriginal ?? undefined,
          xmlStoragePath,
          xmlHash: params.xmlHash,
          chaveAcesso: params.campos.chaveAcesso,
          cteEmitenteCnpj: params.campos.cteEmitenteCnpj,
          cteEmitenteNome: params.campos.cteEmitenteNome,
          cteValorPrestacao: params.campos.cteValorPrestacao,
          cteValorReceber: params.campos.cteValorReceber,
          cteDhEmissao: params.campos.cteDhEmissao,
          cteSituacao: params.campos.cteSituacao,
          tpCte: params.campos.tpCte,
          cfop: params.campos.cfop,
          modal: params.campos.modal,
          ufIni: params.campos.ufIni,
          ufFim: params.campos.ufFim,
          cteTomadorCnpj: params.campos.cteTomadorCnpj,
          cteRemetenteCnpj: params.campos.cteRemetenteCnpj,
          cteDestinatarioCnpj: params.campos.cteDestinatarioCnpj,
          cteExpedidorCnpj: params.campos.cteExpedidorCnpj,
          cteRecebedorCnpj: params.campos.cteRecebedorCnpj,
          cteTomadorNome: params.campos.cteTomadorNome,
          cteRemetenteNome: params.campos.cteRemetenteNome,
          cteDestinatarioNome: params.campos.cteDestinatarioNome,
          cteExpedidorNome: params.campos.cteExpedidorNome,
          cteRecebedorNome: params.campos.cteRecebedorNome,
          cteChavesNfe: params.campos.cteChavesNfe,
          eventoTipo: params.campos.eventoTipo,
          eventoDescricao: params.campos.eventoDescricao,
        },
        select: { id: true },
      });
      return doc.id;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        return false; // NSU já existe — idempotência
      }
      throw err;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Backfill: reprocessa XMLs existentes para popular os nomes dos participantes
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Reprocessa os XMLs de CT-e já baixados para popular os nomes dos participantes
   * (remetente/destinatário/expedidor/recebedor/tomador) em documentos antigos,
   * persistidos antes da captura desses nomes.
   */
  async backfillParticipantes(tenantId?: string): Promise<{ processados: number; atualizados: number; erros: number }> {
    let processados = 0;
    let atualizados = 0;
    let erros = 0;
    const BATCH = 200;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { tipoDocumento: 'PROC_CTE', cteRemetenteNome: null };
    if (tenantId) where.tenantId = tenantId;

    const total = await this.prisma.cteDocumento.count({ where });
    this.logger.log(`Backfill participantes CT-e: ${total} documento(s) a processar`);

    let cursor: string | undefined;
    for (;;) {
      const docs = await this.prisma.cteDocumento.findMany({
        where,
        select: { id: true, xmlOriginal: true, xmlStoragePath: true },
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
          const campos = this.extrairProcCte(parsed);
          if (
            !campos.cteRemetenteNome && !campos.cteDestinatarioNome && !campos.cteTomadorNome &&
            !campos.cteExpedidorNome && !campos.cteRecebedorNome
          ) {
            continue;
          }
          await this.prisma.cteDocumento.update({
            where: { id: doc.id },
            data: {
              cteTomadorNome: campos.cteTomadorNome ?? null,
              cteRemetenteNome: campos.cteRemetenteNome ?? null,
              cteDestinatarioNome: campos.cteDestinatarioNome ?? null,
              cteExpedidorNome: campos.cteExpedidorNome ?? null,
              cteRecebedorNome: campos.cteRecebedorNome ?? null,
            },
          });
          atualizados++;
        } catch (err) {
          erros++;
          this.logger.warn(`Backfill participantes erro doc ${doc.id}: ${(err as Error).message}`);
        }
      }
      this.logger.debug(`Backfill participantes: ${processados}/${total} (atualizados=${atualizados} erros=${erros})`);
    }

    this.logger.log(`Backfill participantes concluído: processados=${processados} atualizados=${atualizados} erros=${erros}`);
    return { processados, atualizados, erros };
  }
}
