import { Injectable, Logger } from '@nestjs/common';
import * as https from 'node:https';
import { XMLParser } from 'fast-xml-parser';
import {
  DistDFeIntRequest,
  ConsNsuRequest,
  RetDistDFeInt,
  CteDocumentoRaw,
  EnvioEventoCteRequest,
  RetEnvioEvento,
  RetEventoItem,
  CTE_ENDPOINTS,
  resolverEndpointEvento,
  TIPO_EVENTO_CTE,
} from './cte.types';
import { CteXmlSignerService } from './cte-xml-signer.service';

/** Número máximo de tentativas para cada requisição SOAP */
const MAX_TENTATIVAS = 3;

/**
 * Cliente SOAP mTLS para os web services do CT-e:
 *  - CTeDistribuicaoDFe   → distNSU / consNSU  (NÃO há consChCTe no CT-e)
 *  - CTeRecepcaoEventoV4  → eventos do tomador (Prestação de Serviço em Desacordo)
 *
 * Namespaces/versões (distDFeInt v1.00, eventoCTe v4.00) seguem o padrão do
 * projeto CT-e; confirmar contra o WSDL/XSD do endpoint antes de produção.
 */
@Injectable()
export class CteSoapClientService {
  private readonly logger = new Logger(CteSoapClientService.name);
  private readonly REQUEST_TIMEOUT_MS = 30_000;

  constructor(private readonly signer: CteXmlSignerService) {}

  // ────────────────────────────────────────────────────────────────────────────
  // API pública — CTeDistribuicaoDFe
  // ────────────────────────────────────────────────────────────────────────────

  /** distNSU — distribui até 50 DF-e a partir do último NSU informado. */
  async consultarDfe(
    req: DistDFeIntRequest,
    pemCert: string,
    pemKey: string,
  ): Promise<RetDistDFeInt> {
    const endpoint = req.tpAmb === 1 ? CTE_ENDPOINTS.producao : CTE_ENDPOINTS.homologacao;

    const nsuPadded = req.ultNSU.padStart(15, '0');
    const soapBody = this.buildEnvelopeDistNSU(req.cnpj, req.cUf, req.tpAmb, nsuPadded);

    this.logger.log(
      `distNSU(CT-e) → CNPJ=${req.cnpj} cUf=${req.cUf} tpAmb=${req.tpAmb} ultNSU=${nsuPadded}`,
    );

    const rawXml = await this.doRequestWithRetry(
      endpoint.url,
      endpoint.soapAction,
      soapBody,
      pemCert,
      pemKey,
      `distNSU(CT-e) CNPJ=${req.cnpj} ultNSU=${nsuPadded}`,
    );

    return this.parseSoapResponse(rawXml);
  }

  /**
   * consNSU — consulta um DF-e vinculado a um NSU específico (recuperação de gaps).
   */
  async consultarNSU(
    req: ConsNsuRequest,
    pemCert: string,
    pemKey: string,
  ): Promise<RetDistDFeInt> {
    const endpoint = req.tpAmb === 1 ? CTE_ENDPOINTS.producao : CTE_ENDPOINTS.homologacao;

    const nsuPadded = req.nsu.padStart(15, '0');
    const soapBody = this.buildEnvelopeConsNSU(req.cnpj, req.cUf, req.tpAmb, nsuPadded);

    this.logger.log(
      `consNSU(CT-e) → CNPJ=${req.cnpj} cUf=${req.cUf} tpAmb=${req.tpAmb} NSU=${nsuPadded}`,
    );

    const rawXml = await this.doRequestWithRetry(
      endpoint.url,
      endpoint.soapAction,
      soapBody,
      pemCert,
      pemKey,
      `consNSU(CT-e) CNPJ=${req.cnpj} NSU=${nsuPadded}`,
    );

    return this.parseSoapResponse(rawXml);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // API pública — CTeRecepcaoEventoV4 (evento do tomador)
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Envia um evento do tomador (ex: Prestação de Serviço em Desacordo, 610110).
   * Assina o <infEvento> com XMLDSig antes de enviar. O endpoint é resolvido pela
   * UF autorizadora do CT-e (a maioria é SVRS).
   */
  async enviarEvento(
    req: EnvioEventoCteRequest,
    pemCert: string,
    pemKey: string,
  ): Promise<RetEnvioEvento> {
    const ambiente = req.tpAmb === 1 ? 'producao' : 'homologacao';
    const endpoint = resolverEndpointEvento(req.ufAutorizador, ambiente);

    const eventoXml = this.buildEventoCte(req);
    const signedXml = this.signer.assinarEvento(eventoXml, pemKey, pemCert);
    const soapEnvelope = this.wrapSoapRecepcaoEvento(signedXml);

    this.logger.log(
      `enviarEvento(CT-e) → CNPJ=${req.cnpj} tpEvento=${req.tpEvento} chCTe=...${req.chCTe.slice(-4)} nSeq=${req.nSeqEvento} autorizador=${req.ufAutorizador}`,
    );

    const rawXml = await this.doRequestWithRetry(
      endpoint.url,
      endpoint.soapAction,
      soapEnvelope,
      pemCert,
      pemKey,
      `enviarEvento(CT-e) CNPJ=${req.cnpj} tpEvento=${req.tpEvento}`,
    );

    return this.parseRecepcaoEventoResponse(rawXml);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Builders de envelope SOAP — CTeDistribuicaoDFe
  // ────────────────────────────────────────────────────────────────────────────

  private buildEnvelopeDistNSU(cnpj: string, cUf: number, tpAmb: 1 | 2, ultNSU: string): string {
    return this.wrapSoapDistribuicao(`
        <distDFeInt xmlns="http://www.portalfiscal.inf.br/cte" versao="1.00">
          <tpAmb>${tpAmb}</tpAmb>
          <cUFAutor>${cUf}</cUFAutor>
          <CNPJ>${cnpj}</CNPJ>
          <distNSU>
            <ultNSU>${ultNSU}</ultNSU>
          </distNSU>
        </distDFeInt>`);
  }

  private buildEnvelopeConsNSU(cnpj: string, cUf: number, tpAmb: 1 | 2, nsu: string): string {
    return this.wrapSoapDistribuicao(`
        <distDFeInt xmlns="http://www.portalfiscal.inf.br/cte" versao="1.00">
          <tpAmb>${tpAmb}</tpAmb>
          <cUFAutor>${cUf}</cUFAutor>
          <CNPJ>${cnpj}</CNPJ>
          <consNSU>
            <NSU>${nsu}</NSU>
          </consNSU>
        </distDFeInt>`);
  }

  /** Envelope SOAP 1.2 do CTeDistribuicaoDFe (operação cteDistDFeInteresse). */
  private wrapSoapDistribuicao(distDFeIntXml: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <cteDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe">
      <cteDadosMsg>${distDFeIntXml}
      </cteDadosMsg>
    </cteDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Builders de envelope SOAP — CTeRecepcaoEventoV4
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Monta o <eventoCTe> (sem assinatura). Atualmente cobre o evento de
   * Prestação de Serviço em Desacordo (610110) com o grupo evPrestDesacordo.
   * Validar o leiaute (cOrgao, versaoEvento) contra o XSD do CT-e 4.00.
   */
  private buildEventoCte(req: EnvioEventoCteRequest): string {
    const nSeqPadded = String(req.nSeqEvento).padStart(2, '0');
    const idEvento = `ID${req.tpEvento}${req.chCTe}${nSeqPadded}`;

    let detEvento: string;
    if (req.tpEvento === TIPO_EVENTO_CTE.DESACORDO.codigo) {
      const xObs = this.escapeXml(req.xObs ?? '');
      detEvento = `<detEvento versaoEvento="4.00">
        <evPrestDesacordo>
          <descEvento>${this.escapeXml(req.descEvento)}</descEvento>
          <indDesacordoOper>1</indDesacordoOper>
          <xObs>${xObs}</xObs>
        </evPrestDesacordo>
      </detEvento>`;
    } else {
      // Cancelamento do desacordo (610111) exige nProtEvento do desacordo original —
      // implementar quando o cancelamento for habilitado na UI.
      throw new Error(`Evento tpEvento=${req.tpEvento} ainda não implementado no builder.`);
    }

    // cOrgao = código da UF do autorizador (cUF). Confirmar no XSD para CT-e.
    return `<eventoCTe versao="4.00" xmlns="http://www.portalfiscal.inf.br/cte">
  <infEvento Id="${idEvento}">
    <cOrgao>${req.cUf}</cOrgao>
    <tpAmb>${req.tpAmb}</tpAmb>
    <CNPJ>${req.cnpj}</CNPJ>
    <chCTe>${req.chCTe}</chCTe>
    <dhEvento>${req.dhEvento}</dhEvento>
    <tpEvento>${req.tpEvento}</tpEvento>
    <nSeqEvento>${req.nSeqEvento}</nSeqEvento>
    ${detEvento}
  </infEvento>
</eventoCTe>`;
  }

  private wrapSoapRecepcaoEvento(eventoXml: string): string {
    const xmlBody = eventoXml.replace(/^<\?xml[^?]*\?>\s*/i, '');
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <cteDadosMsg xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoEventoV4">${xmlBody}</cteDadosMsg>
  </soap12:Body>
</soap12:Envelope>`;
  }

  private parseRecepcaoEventoResponse(xml: string): RetEnvioEvento {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true,
    });

    let parsed: any;
    try {
      parsed = parser.parse(xml);
    } catch (err) {
      throw new Error(`Falha ao parsear resposta CTeRecepcaoEvento: ${(err as Error).message}`, { cause: err });
    }

    const body = parsed?.Envelope?.Body ?? {};
    const ret =
      body?.cteRecepcaoEventoResult?.retEventoCTe
      ?? body?.cteRecepcaoEventoResponse?.cteRecepcaoEventoResult?.retEventoCTe
      ?? body?.cteRecepcaoEventoV4Response?.cteRecepcaoEventoV4Result?.retEventoCTe
      ?? body?.cteDadosMsg?.retEventoCTe
      ?? body?.retEventoCTe;

    if (!ret) {
      this.logger.error('Resposta CTeRecepcaoEvento inesperada:', JSON.stringify(parsed).substring(0, 500));
      throw new Error('Elemento retEventoCTe não encontrado na resposta SEFAZ');
    }

    const retEventoRaw = ret.retEvento ?? ret.eventoCTe ?? ret;
    const retEventoArray: any[] = Array.isArray(retEventoRaw) ? retEventoRaw : retEventoRaw ? [retEventoRaw] : [];

    const retEvento: RetEventoItem[] = retEventoArray.map((re: any) => {
      const inf = re?.infEvento ?? re;
      return {
        cStat: String(inf.cStat ?? ''),
        xMotivo: String(inf.xMotivo ?? ''),
        chCTe: String(inf.chCTe ?? ''),
        tpEvento: String(inf.tpEvento ?? ''),
        xEvento: String(inf.xEvento ?? ''),
        nSeqEvento: String(inf.nSeqEvento ?? ''),
        nProt: inf.nProt ? String(inf.nProt) : undefined,
        dhRegEvento: inf.dhRegEvento ? String(inf.dhRegEvento) : undefined,
      };
    });

    return {
      tpAmb: String(ret.tpAmb ?? ''),
      verAplic: String(ret.verAplic ?? ''),
      cStat: String(ret.cStat ?? ''),
      xMotivo: String(ret.xMotivo ?? ''),
      cOrgao: String(ret.cOrgao ?? ''),
      retEvento,
    };
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // HTTP/HTTPS com mTLS e backoff exponencial
  // ────────────────────────────────────────────────────────────────────────────

  private async doRequestWithRetry(
    url: string,
    soapAction: string,
    body: string,
    cert: string,
    key: string,
    contexto: string,
    soapVersion: '1.1' | '1.2' = '1.2',
  ): Promise<string> {
    let tentativa = 0;

    while (true) {
      tentativa++;
      const startMs = Date.now();

      try {
        const rawXml = await this.doRequest(url, soapAction, body, cert, key, soapVersion);
        const duracaoMs = Date.now() - startMs;
        this.logger.debug(`SEFAZ OK [${contexto}] tentativa=${tentativa} ${duracaoMs}ms`);
        return rawXml;
      } catch (err) {
        const duracaoMs = Date.now() - startMs;
        const msg = (err as Error).message;

        if (tentativa >= MAX_TENTATIVAS) {
          this.logger.error(
            `SEFAZ FALHA DEFINITIVA [${contexto}] tentativa=${tentativa}/${MAX_TENTATIVAS} ${duracaoMs}ms: ${msg}`,
          );
          throw err;
        }

        const backoffMs = Math.pow(2, tentativa) * 1000;
        this.logger.warn(
          `SEFAZ erro [${contexto}] tentativa=${tentativa}/${MAX_TENTATIVAS}, retry em ${backoffMs}ms: ${msg}`,
        );
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }

  private doRequest(
    url: string,
    soapAction: string,
    body: string,
    cert: string,
    key: string,
    soapVersion: '1.1' | '1.2' = '1.2',
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const bodyBuffer = Buffer.from(body, 'utf8');
      const parsed = new URL(url);

      const agent = new https.Agent({
        cert,
        key,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
      });

      const soapHeaders =
        soapVersion === '1.1'
          ? {
              'Content-Type': 'text/xml; charset=utf-8',
              SOAPAction: `"${soapAction}"`,
            }
          : {
              'Content-Type': `application/soap+xml; charset=utf-8; action="${soapAction}"`,
            };

      const options: https.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname,
        method: 'POST',
        agent,
        headers: {
          ...soapHeaders,
          'Content-Length': bodyBuffer.length,
        },
        timeout: this.REQUEST_TIMEOUT_MS,
      };

      const reqHttp = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode && res.statusCode >= 500) {
            reject(new Error(`SEFAZ HTTP ${res.statusCode}: ${responseBody.substring(0, 500)}`));
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`SEFAZ HTTP ${res.statusCode} (sem retry): ${responseBody.substring(0, 500)}`));
            return;
          }
          resolve(responseBody);
        });
      });

      reqHttp.on('timeout', () => {
        reqHttp.destroy(new Error(`Timeout SEFAZ (${this.REQUEST_TIMEOUT_MS}ms)`));
      });
      reqHttp.on('error', reject);
      reqHttp.write(bodyBuffer);
      reqHttp.end();
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Parse da resposta SOAP — CTeDistribuicaoDFe
  // ────────────────────────────────────────────────────────────────────────────

  private parseSoapResponse(xml: string): RetDistDFeInt {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true,
    });

    let parsed: any;
    try {
      parsed = parser.parse(xml);
    } catch (err) {
      throw new Error(`Falha ao parsear XML da SEFAZ: ${(err as Error).message}`, { cause: err });
    }

    const retDist =
      parsed?.Envelope?.Body?.cteDistDFeInteresseResponse?.cteDistDFeInteresseResult?.retDistDFeInt
      ?? parsed?.Envelope?.Body?.cteDistDFeInteresse?.cteDadosMsg?.retDistDFeInt
      ?? parsed?.Envelope?.Body?.retDistDFeInt;

    if (!retDist) {
      this.logger.error('Resposta SEFAZ inesperada:', JSON.stringify(parsed).substring(0, 1000));
      throw new Error('Elemento retDistDFeInt não encontrado na resposta SEFAZ');
    }

    const documentos: CteDocumentoRaw[] = this.extractDocumentos(retDist);

    const ultNSU = String(retDist.ultNSU ?? '000000000000000').padStart(15, '0');
    const maxNSU = retDist.maxNSU ? String(retDist.maxNSU).padStart(15, '0') : ultNSU;

    return {
      tpAmb: String(retDist.tpAmb ?? ''),
      verAplic: String(retDist.verAplic ?? ''),
      cStat: String(retDist.cStat ?? ''),
      xMotivo: String(retDist.xMotivo ?? ''),
      dhResp: String(retDist.dhResp ?? ''),
      ultNSU,
      maxNSU,
      documentos,
    };
  }

  private extractDocumentos(retDist: any): CteDocumentoRaw[] {
    const lote = retDist?.loteDistDFeInt?.docZip;
    if (!lote) return [];

    const docs = Array.isArray(lote) ? lote : [lote];

    return docs
      .filter((d: any) => d && (d['#text'] || typeof d === 'string'))
      .map((d: any): CteDocumentoRaw => ({
        nsu: String(d['@_NSU'] ?? '').padStart(15, '0'),
        schema: String(d['@_schema'] ?? ''),
        conteudoBase64GZip: typeof d === 'string' ? d : String(d['#text'] ?? ''),
      }));
  }
}
