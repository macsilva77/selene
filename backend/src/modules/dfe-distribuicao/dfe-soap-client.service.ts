import { Injectable, Logger } from '@nestjs/common';
import * as https from 'node:https';
import { XMLParser } from 'fast-xml-parser';
import {
  DistDFeIntRequest,
  ConsNsuRequest,
  ConsChNFeRequest,
  RetDistDFeInt,
  DfeDocumentoRaw,
  EnvioEventoRequest,
  RetEnvioEvento,
  RetEventoItem,
  DFE_ENDPOINTS,
  DFE_EVENTO_ENDPOINTS,
} from './dfe.types';
import { DfeXmlSignerService } from './dfe-xml-signer.service';

/** Número máximo de tentativas para cada requisição SOAP */
const MAX_TENTATIVAS = 3;

/**
 * Cliente SOAP mTLS para os web services da SEFAZ:
 *  - NFeDistribuicaoDFe  → distNSU / consNSU / consChNFe
 *  - NFeRecepcaoEvento   → manifestação do destinatário
 *
 * Todas as chamadas:
 *  - usam mTLS com certificado PEM (sem senha — carregado via DfeCertLoaderService)
 *  - aplicam backoff exponencial (2^n * 1000ms) até MAX_TENTATIVAS tentativas
 *  - são compatíveis com TLS 1.2+ exigido pela SEFAZ
 */
@Injectable()
export class DfeSoapClientService {
  private readonly logger = new Logger(DfeSoapClientService.name);
  /** Timeout de rede por tentativa (ms) */
  private readonly REQUEST_TIMEOUT_MS = 30_000;

  constructor(private readonly signer: DfeXmlSignerService) {}

  // ────────────────────────────────────────────────────────────────────────────
  // API pública — NFeDistribuicaoDFe
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * distNSU — distribui até 50 DF-e a partir do último NSU informado.
   * MOC 7.0 seção 5.7.4.1 / 5.7.4.4.
   */
  async consultarDfe(
    req: DistDFeIntRequest,
    pemCert: string,
    pemKey: string,
  ): Promise<RetDistDFeInt> {
    const endpoint =
      req.tpAmb === 1 ? DFE_ENDPOINTS.producao : DFE_ENDPOINTS.homologacao;

    const nsuPadded = req.ultNSU.padStart(15, '0');
    const soapBody = this.buildEnvelopeDistNSU(req.cnpj, req.cUf, req.tpAmb, nsuPadded);

    this.logger.log(
      `distNSU → CNPJ=${req.cnpj} cUf=${req.cUf} tpAmb=${req.tpAmb} ultNSU=${nsuPadded}`,
    );

    const rawXml = await this.doRequestWithRetry(
      endpoint.url,
      endpoint.soapAction,
      soapBody,
      pemCert,
      pemKey,
      `distNSU CNPJ=${req.cnpj} ultNSU=${nsuPadded}`,
    );

    return this.parseSoapResponse(rawXml);
  }

  /**
   * consNSU — consulta um DF-e vinculado a um NSU específico.
   * Utilizado para recuperar lacunas detectadas na sequência de NSUs.
   * MOC 7.0 seção 5.7.4.5.
   */
  async consultarNSU(
    req: ConsNsuRequest,
    pemCert: string,
    pemKey: string,
  ): Promise<RetDistDFeInt> {
    const endpoint =
      req.tpAmb === 1 ? DFE_ENDPOINTS.producao : DFE_ENDPOINTS.homologacao;

    const nsuPadded = req.nsu.padStart(15, '0');
    const soapBody = this.buildEnvelopeConsNSU(req.cnpj, req.cUf, req.tpAmb, nsuPadded);

    this.logger.log(
      `consNSU → CNPJ=${req.cnpj} cUf=${req.cUf} tpAmb=${req.tpAmb} NSU=${nsuPadded}`,
    );

    const rawXml = await this.doRequestWithRetry(
      endpoint.url,
      endpoint.soapAction,
      soapBody,
      pemCert,
      pemKey,
      `consNSU CNPJ=${req.cnpj} NSU=${nsuPadded}`,
    );

    return this.parseSoapResponse(rawXml);
  }

  /**
   * consChNFe — consulta NF-e pela chave de acesso.
   * Disponível apenas nos últimos 90 dias e apenas para destinatário,
   * transportador ou terceiros autorizados (autXML).
   * MOC 7.0 seção 5.7.4.6.
   */
  async consultarChNFe(
    req: ConsChNFeRequest,
    pemCert: string,
    pemKey: string,
  ): Promise<RetDistDFeInt> {
    const endpoint =
      req.tpAmb === 1 ? DFE_ENDPOINTS.producao : DFE_ENDPOINTS.homologacao;

    const soapBody = this.buildEnvelopeConsChNFe(req.cnpj, req.cUf, req.tpAmb, req.chNFe);

    this.logger.log(
      `consChNFe → CNPJ=${req.cnpj} cUf=${req.cUf} tpAmb=${req.tpAmb} chNFe=${req.chNFe}`,
    );

    const rawXml = await this.doRequestWithRetry(
      endpoint.url,
      endpoint.soapAction,
      soapBody,
      pemCert,
      pemKey,
      `consChNFe CNPJ=${req.cnpj} chNFe=${req.chNFe}`,
    );

    return this.parseSoapResponse(rawXml);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // API pública — NFeRecepcaoEvento (Manifestação do Destinatário)
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * envEvento (manifestação do destinatário) — MOC 7.0 seção 5.11.
   * Assina o XML do evento com XMLDSig RSA-SHA256 antes de enviar.
   */
  async enviarManifestacao(
    req: EnvioEventoRequest,
    pemCert: string,
    pemKey: string,
  ): Promise<RetEnvioEvento> {
    const endpoint =
      req.tpAmb === 1 ? DFE_EVENTO_ENDPOINTS.producao : DFE_EVENTO_ENDPOINTS.homologacao;

    // Constrói o XML do evento sem assinatura
    const envEventoXml = this.buildEnvEvento(req);

    // Assina o <infEvento> com XMLDSig via DfeXmlSignerService
    const signedXml = this.signer.assinarEvento(envEventoXml, pemKey, pemCert);

    const soapEnvelope = this.wrapSoapRecepcaoEvento(signedXml);

    this.logger.log(
      `envManifestacao → CNPJ=${req.cnpj} tpEvento=${req.tpEvento} chNFe=...${req.chNFe.slice(-4)} nSeq=${req.nSeqEvento}`,
    );

    // SOAP 1.2 — mesmo padrão do NFeDistribuicaoDFe (action no Content-Type)
    const rawXml = await this.doRequestWithRetry(
      endpoint.url,
      endpoint.soapAction,
      soapEnvelope,
      pemCert,
      pemKey,
      `envManifestacao CNPJ=${req.cnpj} tpEvento=${req.tpEvento}`,
    );

    return this.parseRecepcaoEventoResponse(rawXml);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Builders de envelope SOAP — NFeDistribuicaoDFe
  // ────────────────────────────────────────────────────────────────────────────

  private buildEnvelopeDistNSU(
    cnpj: string,
    cUf: number,
    tpAmb: 1 | 2,
    ultNSU: string,
  ): string {
    return this.wrapSoapBody(`
        <distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
          <tpAmb>${tpAmb}</tpAmb>
          <cUFAutor>${cUf}</cUFAutor>
          <CNPJ>${cnpj}</CNPJ>
          <distNSU>
            <ultNSU>${ultNSU}</ultNSU>
          </distNSU>
        </distDFeInt>`);
  }

  private buildEnvelopeConsNSU(
    cnpj: string,
    cUf: number,
    tpAmb: 1 | 2,
    nsu: string,
  ): string {
    return this.wrapSoapBody(`
        <distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
          <tpAmb>${tpAmb}</tpAmb>
          <cUFAutor>${cUf}</cUFAutor>
          <CNPJ>${cnpj}</CNPJ>
          <consNSU>
            <NSU>${nsu}</NSU>
          </consNSU>
        </distDFeInt>`);
  }

  private buildEnvelopeConsChNFe(
    cnpj: string,
    cUf: number,
    tpAmb: 1 | 2,
    chNFe: string,
  ): string {
    return this.wrapSoapBody(`
        <distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
          <tpAmb>${tpAmb}</tpAmb>
          <cUFAutor>${cUf}</cUFAutor>
          <CNPJ>${cnpj}</CNPJ>
          <consChNFe>
            <chNFe>${chNFe}</chNFe>
          </consChNFe>
        </distDFeInt>`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Builders de envelope SOAP — NFeRecepcaoEvento
  // ────────────────────────────────────────────────────────────────────────────

  private buildEnvEvento(req: EnvioEventoRequest): string {
    const nSeqPadded = String(req.nSeqEvento).padStart(2, '0');
    const idEvento = `ID${req.tpEvento}${req.chNFe}${nSeqPadded}`;
    const detExtra =
      req.xJust
        ? `\n        <xJust>${this.escapeXml(req.xJust)}</xJust>`
        : '';

    return `<envEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <idLote>${req.idLote}</idLote>
  <evento versao="1.00">
    <infEvento Id="${idEvento}">
      <cOrgao>91</cOrgao>
      <tpAmb>${req.tpAmb}</tpAmb>
      <CNPJ>${req.cnpj}</CNPJ>
      <chNFe>${req.chNFe}</chNFe>
      <dhEvento>${req.dhEvento}</dhEvento>
      <tpEvento>${req.tpEvento}</tpEvento>
      <nSeqEvento>${req.nSeqEvento}</nSeqEvento>
      <verEvento>1.00</verEvento>
      <detEvento versao="1.00">
        <descEvento>${this.escapeXml(req.descEvento)}</descEvento>${detExtra}
      </detEvento>
    </infEvento>
  </evento>
</envEvento>`;
  }

  private wrapSoapRecepcaoEvento(envEventoXml: string): string {
    // xml-crypto's getSignedXml() may prepend <?xml?> — strip it before embedding inside Body
    const xmlBody = envEventoXml.replace(/^<\?xml[^?]*\?>\s*/i, '');
    // SOAP 1.2 — mesmo padrão do NFeDistribuicaoDFe: nfeDadosMsg como elemento direto do Body,
    // action no Content-Type. O método SOAP é "nfeRecepcaoEvento" (sem o 4).
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${xmlBody}</nfeDadosMsg>
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
      throw new Error(`Falha ao parsear resposta NFeRecepcaoEvento: ${(err as Error).message}`);
    }

    const body = parsed?.Envelope?.Body ?? {};
    const ret =
      // Resposta real observada: nfeRecepcaoEventoNFResult
      body?.nfeRecepcaoEventoNFResult?.retEnvEvento
      // Variações possíveis
      ?? body?.nfeRecepcaoEventoResponse?.nfeRecepcaoEventoResult?.retEnvEvento
      ?? body?.nfeRecepcaoEvento4Response?.nfeRecepcaoEvento4Result?.retEnvEvento
      ?? body?.nfeDadosMsg?.retEnvEvento
      ?? body?.retEnvEvento;

    if (!ret) {
      this.logger.error('Resposta NFeRecepcaoEvento inesperada:', JSON.stringify(parsed).substring(0, 500));
      throw new Error('Elemento retEnvEvento não encontrado na resposta SEFAZ');
    }

    const retEventoRaw = ret.retEvento;
    const retEventoArray: any[] = Array.isArray(retEventoRaw)
      ? retEventoRaw
      : retEventoRaw
        ? [retEventoRaw]
        : [];

    const retEvento: RetEventoItem[] = retEventoArray.map((re: any) => {
      const inf = re?.infEvento ?? re;
      return {
        cStat: String(inf.cStat ?? ''),
        xMotivo: String(inf.xMotivo ?? ''),
        chNFe: String(inf.chNFe ?? ''),
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

  /** Envolve o conteúdo do distDFeInt no envelope SOAP 1.2 padrão SEFAZ */
  private wrapSoapBody(distDFeIntXml: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDadosMsg>${distDFeIntXml}
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // HTTP/HTTPS com mTLS e backoff exponencial
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Executa a requisição HTTP com backoff exponencial.
   * Tentativas: 1ª imediata → 2ª após 2s → 3ª após 4s → lança o erro.
   *
   * Erros de negócio SEFAZ (cStat de rejeição) NÃO são retentados aqui —
   * o retry cobre apenas falhas de rede/timeout/HTTP 5xx.
   */
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

      // SOAP 1.1: text/xml + SOAPAction header (ASMX NFeRecepcaoEvento4)
      // SOAP 1.2: application/soap+xml + action no Content-Type (NFeDistribuicaoDFe)
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
            // HTTP 5xx: retentável
            reject(new Error(`SEFAZ HTTP ${res.statusCode}: ${responseBody.substring(0, 500)}`));
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            // HTTP 4xx: não retenta — erro de protocolo/autorização
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
  // Parse da resposta SOAP
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
      throw new Error(`Falha ao parsear XML da SEFAZ: ${(err as Error).message}`);
    }

    // Navega na árvore SOAP até retDistDFeInt
    const retDist =
      parsed?.Envelope?.Body?.nfeDistDFeInteresseResponse?.nfeDistDFeInteresseResult?.retDistDFeInt
      ?? parsed?.Envelope?.Body?.nfeDistDFeInteresse?.nfeDadosMsg?.retDistDFeInt;

    if (!retDist) {
      this.logger.error('Resposta SEFAZ inesperada:', JSON.stringify(parsed).substring(0, 1000));
      throw new Error('Elemento retDistDFeInt não encontrado na resposta SEFAZ');
    }

    const documentos: DfeDocumentoRaw[] = this.extractDocumentos(retDist);

    const ultNSU = String(retDist.ultNSU ?? '000000000000000').padStart(15, '0');
    // Se a SEFAZ não retornar maxNSU (campo opcional em cStat=137), usa ultNSU como
    // valor efetivo de teto — sinaliza "alcançamos o máximo" sem corromper o DB com zeros.
    const maxNSU = retDist.maxNSU
      ? String(retDist.maxNSU).padStart(15, '0')
      : ultNSU;

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

  private extractDocumentos(retDist: any): DfeDocumentoRaw[] {
    const lote = retDist?.loteDistDFeInt?.docZip;
    if (!lote) return [];

    const docs = Array.isArray(lote) ? lote : [lote];

    return docs
      .filter((d: any) => d && (d['#text'] || typeof d === 'string'))
      .map((d: any): DfeDocumentoRaw => ({
        nsu: String(d['@_NSU'] ?? '').padStart(15, '0'),
        schema: String(d['@_schema'] ?? ''),
        iPosNSU: String(d['@_iPosNSU'] ?? '0'),
        qNSUItem: String(d['@_qNSUItem'] ?? '0'),
        conteudoBase64GZip: typeof d === 'string' ? d : String(d['#text'] ?? ''),
      }));
  }
}
