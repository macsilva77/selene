import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { PrismaService } from '../../database/prisma.service';
import {
  DESCRICAO_EVENTO_NFSE,
  EVENTOS_CANCELAMENTO,
  NfseConteudoProcessado,
  NfseDocumentoRaw,
  NfseEventoProcessado,
  NfsePapelTitular,
  NfseProcessada,
  NfseTipoDocumento,
} from './nfse.types';

/**
 * Descompacta (quando aplicável), identifica, parseia e persiste cada documento
 * NFS-e recebido pela distribuição do ADN.
 *
 * Espelha o DfeXmlProcessorService da NF-e. A camada de transporte (cliente REST do
 * ADN, NSU, GCS e Pub/Sub) será plugada quando a spec da API estiver definida; por ora
 * o XML é persistido no próprio banco (xmlOriginal) e o foco é a extração de campos.
 */
@Injectable()
export class NfseXmlProcessorService {
  private readonly logger = new Logger(NfseXmlProcessorService.name);

  // parseTagValue: false previne que o fast-xml-parser converta chaves de acesso (50/45
  // dígitos) e demais identificadores numéricos para float (perda de precisão / notação
  // científica). Valores monetários são convertidos explicitamente com parseFloat abaixo.
  private readonly xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
  });

  constructor(private readonly prisma: PrismaService) {}

  // ────────────────────────────────────────────────────────────────────────────
  // API pública
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Processa um documento recebido na distribuição.
   * Retorna `null` se já existia (idempotência por chave).
   */
  async processarDocumento(
    raw: NfseDocumentoRaw,
    tenantId: string,
    cnpjTitular: string,
  ): Promise<{ id: string; tipo: NfseTipoDocumento } | null> {
    const xmlBuffer = Buffer.from(raw.xml, 'utf8');
    const xmlHash = createHash('sha256').update(xmlBuffer).digest('hex');

    const conteudo = this.extrair(raw.xml);
    if (!conteudo) {
      throw new Error('XML NFS-e não reconhecido (nem NFSe nem evento)');
    }

    if (conteudo.tipo === 'NFSE') {
      const id = await this.persistirNfse(conteudo, tenantId, cnpjTitular, xmlBuffer, xmlHash, raw.nsu);
      if (id) await this.aplicarEtiquetaPadrao(id, tenantId);
      return id ? { id, tipo: 'NFSE' } : null;
    }
    const id = await this.persistirEvento(conteudo, tenantId, xmlBuffer, xmlHash, raw.nsu);
    return id ? { id, tipo: 'EVENTO' } : null;
  }

  /** Aplica a etiqueta padrão do tenant à NFS-e recém-criada (best-effort). */
  private async aplicarEtiquetaPadrao(documentoId: string, tenantId: string): Promise<void> {
    try {
      const padrao = await this.prisma.etiqueta.findFirst({
        where: { tenantId, padrao: true, deletadoEm: null },
        select: { id: true },
      });
      if (padrao) {
        await this.prisma.nfseDocumentoEtiqueta.createMany({
          data: [{ documentoId, etiquetaId: padrao.id }],
          skipDuplicates: true,
        });
      }
    } catch (err) {
      this.logger.warn(`Falha ao aplicar etiqueta padrão à NFS-e ${documentoId}: ${(err as Error).message}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Identificação + extração (funções puras — testáveis sem banco)
  // ────────────────────────────────────────────────────────────────────────────

  /** Identifica se o XML é uma NFS-e ou um evento pela raiz. */
  identificarTipo(xml: string): NfseTipoDocumento | null {
    const parsed = this.parse(xml);
    if (!parsed) return null;
    if (parsed.NFSe ?? parsed.infNFSe) return 'NFSE';
    if (parsed.evento ?? parsed.infEvento) return 'EVENTO';
    return null;
  }

  /** Parseia e extrai os campos do documento (NFS-e ou evento). */
  extrair(xml: string): NfseConteudoProcessado | null {
    const parsed = this.parse(xml);
    if (!parsed) return null;
    if (parsed.NFSe ?? parsed.infNFSe) return this.extrairNfse(parsed);
    if (parsed.evento ?? parsed.infEvento) return this.extrairEvento(parsed);
    return null;
  }

  private parse(xml: string): any | null {
    try {
      return this.xmlParser.parse(xml);
    } catch (err) {
      this.logger.warn(`Falha ao parsear XML NFS-e: ${(err as Error).message}`);
      return null;
    }
  }

  private extrairNfse(parsed: any): NfseProcessada {
    const nfse = parsed?.NFSe ?? parsed;
    const infNFSe = nfse?.infNFSe ?? {};
    const emit = infNFSe?.emit ?? {};
    const valores = infNFSe?.valores ?? {};
    const infDPS = infNFSe?.DPS?.infDPS ?? {};
    const prest = infDPS?.prest ?? {};
    const regTrib = prest?.regTrib ?? {};
    const cServ = infDPS?.serv?.cServ ?? {};
    const tribMun = infDPS?.valores?.trib?.tribMun ?? {};
    const vServPrest = infDPS?.valores?.vServPrest ?? {};

    const chaveAcesso = this.stripPrefixo(infNFSe?.['@_Id'], 'NFS');

    return {
      tipo: 'NFSE',
      chaveAcesso,
      numero: this.str(infNFSe?.nNFSe),
      ambGerador: this.int(infNFSe?.ambGer),
      codMunEmissor: chaveAcesso ? chaveAcesso.substring(0, 7) : undefined,
      codMunIncidencia: this.str(infNFSe?.cLocIncid),
      dhProcessamento: this.data(infNFSe?.dhProc),
      competencia: this.data(infDPS?.dCompet),

      prestadorDoc: this.doc(emit) ?? this.doc(prest),
      prestadorNome: this.str(emit?.xNome) ?? this.str(prest?.xNome),
      prestadorIm: this.str(emit?.IM) ?? this.str(prest?.IM),
      prestadorOpSimpNac: this.int(regTrib?.opSimpNac),
      prestadorRegEspTrib: this.int(regTrib?.regEspTrib),

      tomadorDoc: this.doc(infDPS?.toma),
      tomadorNome: this.str(infDPS?.toma?.xNome),
      intermediarioDoc: this.doc(infDPS?.interm),
      intermediarioNome: this.str(infDPS?.interm?.xNome),

      codTribNac: this.str(cServ?.cTribNac),
      codTribMun: this.str(cServ?.cTribMun?.cTribMun ?? cServ?.cTribMun),
      descricaoServico: this.str(cServ?.xDescServ),
      codNbs: this.str(cServ?.cNBS),

      valorServico: this.num(vServPrest?.vServ),
      valorBcIssqn: this.num(valores?.vBC),
      aliquotaIssqn: this.num(valores?.pAliqAplic ?? tribMun?.pAliq),
      valorIssqn: this.num(valores?.vISSQN),
      valorTotalRet: this.num(valores?.vTotalRet),
      valorLiquido: this.num(valores?.vLiq),
      tribIssqn: this.int(tribMun?.tribISSQN),
      tpRetIssqn: this.int(tribMun?.tpRetISSQN),

      chaveDps: this.stripPrefixo(infDPS?.['@_Id'], 'DPS') || undefined,
      numeroDps: this.str(infDPS?.nDPS),
      serieDps: this.str(infDPS?.serie),
    };
  }

  private extrairEvento(parsed: any): NfseEventoProcessado {
    const evento = parsed?.evento ?? parsed;
    const infEvento = evento?.infEvento ?? {};
    const infPedReg = infEvento?.pedRegEvento?.infPedReg ?? {};

    // O detalhe do evento é um filho cujo nome casa /^e\d{6}$/ (ex: e101101)
    const tipoEvento =
      Object.keys(infPedReg).find((k) => /^e\d{6}$/.test(k)) ?? '';
    const det = (tipoEvento && infPedReg[tipoEvento]) || {};

    return {
      tipo: 'EVENTO',
      chaveNfse: this.str(infPedReg?.chNFSe) ?? '',
      tipoEvento,
      descricaoEvento: tipoEvento ? DESCRICAO_EVENTO_NFSE[tipoEvento] : undefined,
      nSeqEvento: this.int(infEvento?.nSeqEvento),
      ambGerador: this.int(infEvento?.ambGer),
      dhProcessamento: this.data(infEvento?.dhProc),
      autorDoc:
        this.digitos(det?.CPFAgTrib) ??
        this.doc(det) ??
        this.doc(infPedReg),
      motivoCodigo: this.str(det?.cMotivo),
      motivoTexto: this.str(det?.xMotivo),
      chaveSubstituta: this.str(det?.chSubstituta),
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Persistência (XML no banco por ora; GCS/Pub-Sub virão com o transporte)
  // ────────────────────────────────────────────────────────────────────────────

  private async persistirNfse(
    nfse: NfseProcessada,
    tenantId: string,
    cnpjTitular: string,
    xmlBuffer: Buffer,
    xmlHash: string,
    nsu?: string,
  ): Promise<string | null> {
    try {
      const doc = await this.prisma.nfseDocumento.create({
        data: {
          tenantId,
          nsu,
          cnpjTitular,
          papelTitular: this.determinarPapel(nfse, cnpjTitular),
          chaveAcesso: nfse.chaveAcesso,
          numero: nfse.numero,
          ambGerador: nfse.ambGerador,
          codMunEmissor: nfse.codMunEmissor,
          codMunIncidencia: nfse.codMunIncidencia,
          dhProcessamento: nfse.dhProcessamento,
          competencia: nfse.competencia,
          prestadorDoc: nfse.prestadorDoc,
          prestadorNome: nfse.prestadorNome,
          prestadorIm: nfse.prestadorIm,
          prestadorOpSimpNac: nfse.prestadorOpSimpNac,
          prestadorRegEspTrib: nfse.prestadorRegEspTrib,
          tomadorDoc: nfse.tomadorDoc,
          tomadorNome: nfse.tomadorNome,
          intermediarioDoc: nfse.intermediarioDoc,
          intermediarioNome: nfse.intermediarioNome,
          codTribNac: nfse.codTribNac,
          codTribMun: nfse.codTribMun,
          descricaoServico: nfse.descricaoServico,
          codNbs: nfse.codNbs,
          valorServico: nfse.valorServico,
          valorBcIssqn: nfse.valorBcIssqn,
          aliquotaIssqn: nfse.aliquotaIssqn,
          valorIssqn: nfse.valorIssqn,
          valorTotalRet: nfse.valorTotalRet,
          valorLiquido: nfse.valorLiquido,
          tribIssqn: nfse.tribIssqn,
          tpRetIssqn: nfse.tpRetIssqn,
          chaveDps: nfse.chaveDps,
          numeroDps: nfse.numeroDps,
          serieDps: nfse.serieDps,
          xmlOriginal: xmlBuffer,
          xmlHash,
        },
        select: { id: true },
      });
      return doc.id;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        // Já existe — idempotência. Backfill do NSU se ainda não gravado.
        if (nsu) {
          await this.prisma.nfseDocumento
            .updateMany({ where: { tenantId, chaveAcesso: nfse.chaveAcesso, nsu: null }, data: { nsu } })
            .catch(() => undefined);
        }
        return null;
      }
      throw err;
    }
  }

  private async persistirEvento(
    evt: NfseEventoProcessado,
    tenantId: string,
    xmlBuffer: Buffer,
    xmlHash: string,
    nsu?: string,
  ): Promise<string | null> {
    // Vincula ao documento se já recebido; aplica cancelamento quando for o caso.
    const documento = await this.prisma.nfseDocumento.findUnique({
      where: { tenantId_chaveAcesso: { tenantId, chaveAcesso: evt.chaveNfse } },
      select: { id: true },
    });

    try {
      const ev = await this.prisma.nfseEvento.create({
        data: {
          tenantId,
          nsu,
          documentoId: documento?.id,
          chaveNfse: evt.chaveNfse,
          tipoEvento: evt.tipoEvento,
          descricaoEvento: evt.descricaoEvento,
          nSeqEvento: evt.nSeqEvento,
          ambGerador: evt.ambGerador,
          dhProcessamento: evt.dhProcessamento,
          autorDoc: evt.autorDoc,
          motivoCodigo: evt.motivoCodigo,
          motivoTexto: evt.motivoTexto,
          chaveSubstituta: evt.chaveSubstituta,
          xmlOriginal: xmlBuffer,
          xmlHash,
        },
        select: { id: true },
      });

      if (documento && EVENTOS_CANCELAMENTO.has(evt.tipoEvento)) {
        await this.prisma.nfseDocumento.update({
          where: { id: documento.id },
          data: { cancelada: true },
        });
      }
      return ev.id;
    } catch (err: any) {
      if (err?.code === 'P2002') return null; // evento já existe — idempotência
      throw err;
    }
  }

  /** Define o papel do titular comparando o CNPJ monitorado com as partes da nota. */
  private determinarPapel(nfse: NfseProcessada, cnpjTitular: string): NfsePapelTitular {
    const alvo = cnpjTitular.replace(/\D/g, '');
    if (nfse.prestadorDoc && nfse.prestadorDoc === alvo) return NfsePapelTitular.PRESTADOR;
    if (nfse.intermediarioDoc && nfse.intermediarioDoc === alvo)
      return NfsePapelTitular.INTERMEDIARIO;
    if (nfse.tomadorDoc && nfse.tomadorDoc === alvo) return NfsePapelTitular.TOMADOR;
    this.logger.warn(
      `CNPJ titular ${alvo} não casou com prestador/tomador/intermediário da NFS-e ${nfse.chaveAcesso}; assumindo TOMADOR`,
    );
    return NfsePapelTitular.TOMADOR;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Helpers de extração
  // ────────────────────────────────────────────────────────────────────────────

  /** CNPJ/CPF/NIF de um nó pessoa (prest/toma/interm/emit), só dígitos. */
  private doc(node: any): string | undefined {
    if (!node) return undefined;
    return this.digitos(node.CNPJ ?? node.CPF ?? node.NIF);
  }

  private digitos(v: unknown): string | undefined {
    const s = String(v ?? '').replace(/\D/g, '');
    return s || undefined;
  }

  private str(v: unknown): string | undefined {
    const s = String(v ?? '').trim();
    return s || undefined;
  }

  private int(v: unknown): number | undefined {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number.parseInt(String(v), 10);
    return Number.isNaN(n) ? undefined : n;
  }

  private num(v: unknown): number | undefined {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number.parseFloat(String(v));
    return Number.isNaN(n) ? undefined : n;
  }

  private stripPrefixo(id: unknown, prefixo: string): string {
    return String(id ?? '').replace(new RegExp(`^${prefixo}`), '').trim();
  }

  /** Aceita ISO datetime, AAAA-MM-DD e AAAAMMDD. */
  private data(v: unknown): Date | undefined {
    const s = String(v ?? '').trim();
    if (!s) return undefined;
    const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    const iso = compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : s;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
}
