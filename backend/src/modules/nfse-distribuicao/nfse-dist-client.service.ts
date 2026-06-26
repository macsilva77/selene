import { Injectable, Logger } from '@nestjs/common';
import * as https from 'node:https';
import { gunzipSync } from 'node:zlib';
import {
  LoteDistribuicaoNSUResponse,
  NfseDistItem,
  NfseDistResultado,
  NfseTipoDocumento,
  NFSE_DIST,
  TipoDocumentoRequisicao,
} from './nfse.types';

/** Número máximo de tentativas por requisição */
const MAX_TENTATIVAS = 3;

/**
 * Cliente REST mTLS para a API de Distribuição do ADN (Swagger "ADN Contribuinte").
 *
 *  - GET /DFe/{ultNSU}             → distribui até 50 DF-e a partir do último NSU
 *  - GET /DFe/{NSU}               → consulta pontual de um NSU (recuperação de gap)
 *  - GET /NFSe/{chave}/eventos    → eventos vinculados a uma NFS-e
 *
 * Manual Integrado SNNFS-e v1.00.02:
 *  - comunicação TLS com autenticação mútua (mTLS), certificado A1/A3 ICP-Brasil;
 *  - conteúdo (ArquivoXml) trafega em GZip + Base64;
 *  - quando ultNSU == maxNSU, aguardar ≥ 1h antes de nova consulta.
 *
 * A base URL do ambiente (produção restrita / produção) é injetada por chamada —
 * o Swagger não define host; vem da configuração do tenant.
 */
@Injectable()
export class NfseDistClientService {
  private readonly logger = new Logger(NfseDistClientService.name);
  private readonly REQUEST_TIMEOUT_MS = 30_000;

  // ────────────────────────────────────────────────────────────────────────────
  // API pública
  // ────────────────────────────────────────────────────────────────────────────

  /** GET /DFe/{ultNSU} — distribui o próximo lote (até 50) a partir do NSU informado. */
  async distribuirAPartirDeNsu(
    baseUrl: string,
    ultNsu: string | number,
    cnpjConsulta: string,
    pemCert: string,
    pemKey: string,
  ): Promise<NfseDistResultado> {
    const url = this.montarUrl(baseUrl, `/DFe/${ultNsu}`, { cnpjConsulta, lote: 'true' });
    this.logger.log(`distribuição → ultNSU=${ultNsu} cnpj=${cnpjConsulta}`);
    const resp = await this.getJson(url, pemCert, pemKey, `DFe ultNSU=${ultNsu}`);
    return this.mapearLote(resp);
  }

  /** GET /DFe/{NSU} — consulta pontual de um NSU faltante (gap). */
  async consultarNsu(
    baseUrl: string,
    nsu: string | number,
    cnpjConsulta: string,
    pemCert: string,
    pemKey: string,
  ): Promise<NfseDistResultado> {
    const url = this.montarUrl(baseUrl, `/DFe/${nsu}`, { cnpjConsulta, lote: 'false' });
    this.logger.log(`consulta NSU pontual → NSU=${nsu} cnpj=${cnpjConsulta}`);
    const resp = await this.getJson(url, pemCert, pemKey, `DFe NSU=${nsu}`);
    return this.mapearLote(resp);
  }

  /** GET /NFSe/{chaveAcesso}/Eventos — eventos vinculados a uma NFS-e. */
  async consultarEventos(
    baseUrl: string,
    chaveAcesso: string,
    pemCert: string,
    pemKey: string,
  ): Promise<NfseDistResultado> {
    const url = this.montarUrl(baseUrl, `/NFSe/${chaveAcesso}/Eventos`);
    this.logger.log(`consulta eventos → chave=...${chaveAcesso.slice(-6)}`);
    const resp = await this.getJson(url, pemCert, pemKey, `Eventos chave=${chaveAcesso}`);
    return this.mapearLote(resp);
  }

  /** GET /danfse/{chaveAcesso} — retorna o PDF do DANFSe da NFS-e. */
  async baixarDanfse(
    baseUrl: string,
    chaveAcesso: string,
    pemCert: string,
    pemKey: string,
  ): Promise<Buffer> {
    // O DANFSe é servido pelo módulo /danfse no HOST RAIZ — NÃO sob /contribuintes.
    // baseUrl é ".../contribuintes"; usamos só a origem + /danfse/{chave}.
    const origin = new URL(baseUrl).origin;
    const url = `${origin}/danfse/${chaveAcesso}`;
    this.logger.log(`DANFSe → ${url}`);
    return this.doGetBinary(url, pemCert, pemKey, 'application/pdf');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Mapeamento da resposta
  // ────────────────────────────────────────────────────────────────────────────

  private mapearLote(resp: LoteDistribuicaoNSUResponse): NfseDistResultado {
    const lote = resp.LoteDFe ?? [];
    const itens: NfseDistItem[] = [];
    let ultimoNsu: string | undefined;

    for (const dfe of lote) {
      if (dfe.NSU != null) {
        const nsuStr = String(dfe.NSU);
        if (ultimoNsu === undefined || dfe.NSU > Number(ultimoNsu)) ultimoNsu = nsuStr;
      }
      const tipo = this.mapearTipo(dfe.TipoDocumento);
      if (!tipo || !dfe.ArquivoXml) continue; // ignora DPS/CNC/NENHUM e itens sem XML
      itens.push({
        nsu: dfe.NSU != null ? String(dfe.NSU) : undefined,
        chaveAcesso: dfe.ChaveAcesso ?? undefined,
        tipo,
        xml: this.decodeArquivoXml(dfe.ArquivoXml),
      });
    }

    return {
      status: resp.StatusProcessamento,
      itens,
      ultimoNsu,
      alertas: (resp.Alertas ?? []).map((m) => this.fmtMensagem(m)),
      erros: (resp.Erros ?? []).map((m) => this.fmtMensagem(m)),
    };
  }

  /** NFSE → NFSE; EVENTO/PEDIDO_REGISTRO_EVENTO → EVENTO; demais → null (ignorado). */
  private mapearTipo(t: TipoDocumentoRequisicao): NfseTipoDocumento | null {
    if (t === 'NFSE') return 'NFSE';
    if (t === 'EVENTO' || t === 'PEDIDO_REGISTRO_EVENTO') return 'EVENTO';
    return null;
  }

  private fmtMensagem(m: { Codigo?: string | null; Descricao?: string | null }): string {
    return [m.Codigo, m.Descricao].filter(Boolean).join(' - ');
  }

  /**
   * Decodifica o ArquivoXml: Base64 → GZip → UTF-8.
   * Tolerante: se não estiver comprimido, trata como Base64 puro; em último caso,
   * assume que já é XML em texto.
   */
  decodeArquivoXml(arquivo: string): string {
    const buf = Buffer.from(arquivo, 'base64');
    try {
      return gunzipSync(buf).toString('utf8');
    } catch {
      const texto = buf.toString('utf8');
      // Heurística: se decodificou para XML, usa; senão devolve o original.
      return texto.trimStart().startsWith('<') ? texto : arquivo;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // HTTP mTLS (GET + retry/backoff) — mesmo padrão de rede do DfeSoapClientService
  // ────────────────────────────────────────────────────────────────────────────

  private montarUrl(
    baseUrl: string,
    path: string,
    query?: Record<string, string>,
  ): string {
    const url = new URL(path.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    return url.toString();
  }

  private async getJson(
    url: string,
    pemCert: string,
    pemKey: string,
    rotulo: string,
  ): Promise<LoteDistribuicaoNSUResponse> {
    let ultimoErro: Error | undefined;
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      try {
        const corpo = await this.doGet(url, pemCert, pemKey);
        return JSON.parse(corpo) as LoteDistribuicaoNSUResponse;
      } catch (err) {
        ultimoErro = err as Error;
        // 4xx (sem retry) é sinalizado por mensagem; não reentra
        if (ultimoErro.message.includes('(sem retry)')) break;
        if (tentativa < MAX_TENTATIVAS) {
          const espera = 2 ** tentativa * 1000;
          this.logger.warn(
            `${rotulo}: tentativa ${tentativa}/${MAX_TENTATIVAS} falhou (${ultimoErro.message}); retry em ${espera}ms`,
          );
          await new Promise((r) => setTimeout(r, espera));
        }
      }
    }
    throw new Error(`Distribuição NFS-e falhou (${rotulo}): ${ultimoErro?.message}`);
  }

  /** GET binário (PDF) com mTLS — retorna o Buffer bruto. */
  private doGetBinary(url: string, cert: string, key: string, accept: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const agent = new https.Agent({
        cert,
        key,
        rejectUnauthorized: true,
        minVersion: NFSE_DIST.TLS_MIN_VERSION,
      });
      const options: https.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        agent,
        headers: { Accept: accept },
        timeout: this.REQUEST_TIMEOUT_MS,
      };
      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const sc = res.statusCode ?? 0;
          const buf = Buffer.concat(chunks);
          if (sc >= 400) {
            return reject(new Error(`ADN HTTP ${sc} (DANFSe): ${buf.toString('utf8').substring(0, 300)}`));
          }
          resolve(buf);
        });
      });
      req.on('timeout', () => req.destroy(new Error(`Timeout ADN (${this.REQUEST_TIMEOUT_MS}ms)`)));
      req.on('error', reject);
      req.end();
    });
  }

  private doGet(url: string, cert: string, key: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const agent = new https.Agent({
        cert,
        key,
        rejectUnauthorized: true,
        minVersion: NFSE_DIST.TLS_MIN_VERSION,
      });

      const options: https.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        agent,
        // A API responde text/plain contendo o JSON (vide Swagger oficial); aceitamos ambos.
        headers: { Accept: 'application/json, text/plain' },
        timeout: this.REQUEST_TIMEOUT_MS,
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const corpo = Buffer.concat(chunks).toString('utf8');
          const sc = res.statusCode ?? 0;
          const alvo = `${parsed.pathname}${parsed.search}`;
          // O ADN responde 404 com corpo JSON (StatusProcessamento=NENHUM_DOCUMENTO_LOCALIZADO,
          // Codigo E2220) quando não há documentos a partir do NSU — é FIM DE FILA, não erro.
          if (sc === 404 && corpo.includes('StatusProcessamento')) return resolve(corpo);
          if (sc >= 500) return reject(new Error(`ADN HTTP ${sc} em ${alvo}: ${corpo.substring(0, 500)}`));
          if (sc >= 400) return reject(new Error(`ADN HTTP ${sc} (sem retry) em ${alvo}: ${corpo.substring(0, 500)}`));
          resolve(corpo);
        });
      });

      req.on('timeout', () => req.destroy(new Error(`Timeout ADN (${this.REQUEST_TIMEOUT_MS}ms)`)));
      req.on('error', reject);
      req.end();
    });
  }
}
