/**
 * PgdasCrawlerService
 *
 * Acessa o Portal do Simples Nacional (PGDAS-D) usando o certificado A1
 * armazenado para a empresa. O acesso ao portal exige autenticação mTLS:
 * o certificado é apresentado durante o handshake TLS.
 *
 * Fluxo:
 *  1. Obtém PFX + senha do CertificadosService.
 *  2. Cria https.Agent com o PFX (autenticação mTLS automática).
 *  3. Navega pelo portal via node:https, mantendo cookie de sessão.
 *  4. Extrai dados das tabelas HTML com regex.
 *  5. Persiste declarações em PgdasDeclaracao (upsert idempotente).
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as https from 'node:https';
import { URL } from 'node:url';
import { PrismaService } from '../../database/prisma.service';
import { CertificadosService } from '../certificados/certificados.service';

// ─── Tipos internos ───────────────────────────────────────────────────────────

export interface DeclaracaoExtraida {
  periodo: string;       // AAAA-MM
  vlReceitaBruta: number;
  vlReceitaComercio: number;
  vlReceitaIndustria: number;
  vlReceitaServicos: number;
  vlDas: number | null;
  situacaoDeclaracao: string;
}

interface CookieJar {
  [name: string]: string;
}

// ─── URLs do Portal Simples Nacional ─────────────────────────────────────────

const SN_BASE       = 'https://www8.receita.fazenda.gov.br';
const PGDAS_PATH    = '/SimplesNacional/Aplicacoes/ATSPO/pgdas.app/emissao/consulta.aspx';
const LOGIN_PATH    = '/SimplesNacional/Aplicacoes/ATSPO/sigass.app/Auth/Index.aspx';

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class PgdasCrawlerService {
  private readonly logger = new Logger(PgdasCrawlerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly certService: CertificadosService,
  ) {}

  // ── Ponto de entrada público ──────────────────────────────────────────────

  async crawl(tenantId: string, empresaId: string): Promise<DeclaracaoExtraida[]> {
    const empresa = await this.prisma.empresa.findFirst({
      where: { id: empresaId, tenantId },
      select: { id: true, cnpj: true },
    });
    if (!empresa) throw new NotFoundException('Empresa não encontrada');

    const cnpj = empresa.cnpj.replace(/\D/g, '').padStart(14, '0');

    // 1. Obter PFX descriptografado do serviço de certificados
    let pfxBase64: string;
    let senha: string;
    try {
      const exported = await this.certService.exportarPfxInterno(cnpj);
      pfxBase64 = exported.pfx_base64;
      senha     = exported.senha;
    } catch {
      throw new NotFoundException(
        `Certificado A1 não encontrado para CNPJ ${cnpj}. ` +
        'Faça o upload do certificado antes de buscar o PGDAS.',
      );
    }

    const pfxBuffer = Buffer.from(pfxBase64, 'base64');
    this.logger.log(`Iniciando crawler PGDAS CNPJ=${cnpj} empresaId=${empresaId}`);

    // 2. Criar agente HTTPS com autenticação mTLS (apresenta o cert no handshake)
    const agent = new https.Agent({
      pfx: pfxBuffer,
      passphrase: senha,
      // Os certificados das ACs ICP-Brasil podem não estar no bundle padrão do Node
      // Em produção, adicione os certificados raiz ICP-Brasil via NODE_EXTRA_CA_CERTS
      rejectUnauthorized: true,
    });

    // 3. Fazer o fluxo de autenticação + coleta do PGDAS
    const cookies = await this.autenticar(agent);
    const html    = await this.obterPaginaPgdas(agent, cookies);
    const declaracoes = extrairDeclaracoes(html);

    this.logger.log(`PGDAS extraído: ${declaracoes.length} período(s) para CNPJ=${cnpj}`);

    // 4. Persistir
    await this.persistir(tenantId, empresaId, cnpj, declaracoes);

    return declaracoes;
  }

  // ── Passo 1: autenticar no portal ────────────────────────────────────────

  private async autenticar(agent: https.Agent): Promise<CookieJar> {
    // O portal redireciona automaticamente após verificar o certificado via TLS.
    // Fazemos GET na página de login; o certificado é apresentado no handshake.
    const resp = await httpsGet(agent, {}, SN_BASE + LOGIN_PATH, { followRedirects: 3 });
    return resp.cookies;
  }

  // ── Passo 2: acessar página do PGDAS ────────────────────────────────────

  private async obterPaginaPgdas(agent: https.Agent, cookies: CookieJar): Promise<string> {
    const resp = await httpsGet(agent, cookies, SN_BASE + PGDAS_PATH, { followRedirects: 5 });
    if (!resp.body.includes('Receita Bruta') && !resp.body.includes('pgdas')) {
      this.logger.warn('Resposta do portal não contém dados de PGDAS — possivelmente redirecionada para login');
      this.logger.debug(`HTML (primeiros 500 chars): ${resp.body.slice(0, 500)}`);
    }
    return resp.body;
  }

  // ── Passo 3: persistência ────────────────────────────────────────────────

  private async persistir(
    tenantId: string,
    empresaId: string,
    cnpj: string,
    declaracoes: DeclaracaoExtraida[],
  ): Promise<void> {
    for (const d of declaracoes) {
      await this.prisma.pgdasDeclaracao.upsert({
        where: { tenantId_empresaId_periodo: { tenantId, empresaId, periodo: d.periodo } },
        create: {
          tenantId,
          empresaId,
          cnpj,
          periodo:            d.periodo,
          vlReceitaBruta:     d.vlReceitaBruta,
          vlReceitaComercio:  d.vlReceitaComercio,
          vlReceitaIndustria: d.vlReceitaIndustria,
          vlReceitaServicos:  d.vlReceitaServicos,
          vlDas:              d.vlDas ?? undefined,
          situacaoDeclaracao: d.situacaoDeclaracao,
        },
        update: {
          vlReceitaBruta:     d.vlReceitaBruta,
          vlReceitaComercio:  d.vlReceitaComercio,
          vlReceitaIndustria: d.vlReceitaIndustria,
          vlReceitaServicos:  d.vlReceitaServicos,
          vlDas:              d.vlDas ?? undefined,
          situacaoDeclaracao: d.situacaoDeclaracao,
        },
      });
    }
    this.logger.log(`PGDAS persistido: ${declaracoes.length} declaração(ões) para empresaId=${empresaId}`);
  }
}

// ─── HTTP helper com mTLS + cookie jar ───────────────────────────────────────

interface GetResponse {
  statusCode: number;
  body: string;
  cookies: CookieJar;
  location?: string;
}

interface GetOptions {
  followRedirects?: number;
}

async function httpsGet(
  agent: https.Agent,
  cookies: CookieJar,
  rawUrl: string,
  opts: GetOptions = {},
): Promise<GetResponse> {
  const maxRedirects = opts.followRedirects ?? 0;

  return new Promise<GetResponse>((resolve, reject) => {
    const parsed = new URL(rawUrl);
    const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');

    const reqOpts: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      agent,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'User-Agent': 'Mozilla/5.0 (compatible; Selene/1.0)',
        ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
      },
    };

    const req = https.request(reqOpts, (res) => {
      // Acumula novos cookies
      const updatedCookies: CookieJar = { ...cookies };
      for (const cookieStr of (res.headers['set-cookie'] ?? [])) {
        const [nameVal] = cookieStr.split(';');
        const eqIdx = nameVal?.indexOf('=') ?? -1;
        if (eqIdx > 0 && nameVal) {
          updatedCookies[nameVal.slice(0, eqIdx).trim()] = nameVal.slice(eqIdx + 1).trim();
        }
      }

      const statusCode = res.statusCode ?? 0;

      // Redireciona
      if (statusCode >= 300 && statusCode < 400 && res.headers.location && maxRedirects > 0) {
        const nextUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : `https://${parsed.hostname}${res.headers.location}`;
        res.resume(); // drena o body para liberar a conexão
        resolve(
          httpsGet(agent, updatedCookies, nextUrl, { followRedirects: maxRedirects - 1 })
            .then(r => ({ ...r, cookies: { ...updatedCookies, ...r.cookies } })),
        );
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk as string; });
      res.on('end', () => resolve({ statusCode, body, cookies: updatedCookies, location: res.headers.location }));
    });

    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error('PGDAS request timeout')); });
    req.end();
  });
}

// ─── Extração de dados do HTML do PGDAS ──────────────────────────────────────
//
// O portal retorna uma tabela HTML com colunas:
//   Período de Apuração | Situação | Receita Total | Comércio | Indústria | Serviços | DAS
//
// Exemplo de linha:
//   <td>01/2024</td><td>Transmitida</td><td>60.000,00</td>...
//
// A estrutura exata pode variar por versão do portal. Ajuste os seletores
// aqui se a extração retornar arrays vazios.

function extrairDeclaracoes(html: string): DeclaracaoExtraida[] {
  const declaracoes: DeclaracaoExtraida[] = [];

  // Encontra linhas <tr> dentro do bloco de dados do PGDAS
  // Heurística: procura tabelas após o header "Período de Apuração"
  const tableMatch = /<table[^>]*>[\s\S]*?Período de Apuração[\s\S]*?<\/table>/i.exec(html);
  if (!tableMatch) {
    // Tenta fallback: extrai qualquer linha com padrão MM/AAAA
    return extrairDeclaracoesFallback(html);
  }

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  // eslint-disable-next-line no-cond-assign
  while ((rowMatch = rowRegex.exec(tableMatch[0])) !== null) {
    const cells = extrairCelulas(rowMatch[1]);
    if (cells.length < 4) continue;

    // Coluna 0: período (MM/AAAA ou AAAA-MM)
    const periodoRaw = cells[0]?.trim() ?? '';
    const periodo = normalizarPeriodo(periodoRaw);
    if (!periodo) continue;

    const situacao  = cells[1]?.trim() ?? 'TRANSMITIDA';
    const bruta     = parseBRL(cells[2] ?? '0');
    const comercio  = parseBRL(cells[3] ?? '0');
    const industria = cells.length > 5 ? parseBRL(cells[4] ?? '0') : 0;
    const servicos  = parseBRL(cells[cells.length - 2] ?? '0');
    const das       = parseBRL(cells[cells.length - 1] ?? '');

    declaracoes.push({
      periodo,
      vlReceitaBruta:     bruta,
      vlReceitaComercio:  comercio,
      vlReceitaIndustria: industria,
      vlReceitaServicos:  servicos,
      vlDas:              das > 0 ? das : null,
      situacaoDeclaracao: normalizarSituacao(situacao),
    });
  }

  return declaracoes;
}

/** Fallback quando a tabela principal não é encontrada: varredura linha por linha. */
function extrairDeclaracoesFallback(html: string): DeclaracaoExtraida[] {
  const declaracoes: DeclaracaoExtraida[] = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = rowRegex.exec(html)) !== null) {
    const cells = extrairCelulas(m[1]);
    if (cells.length < 3) continue;
    const periodo = normalizarPeriodo(cells[0]?.trim() ?? '');
    if (!periodo) continue;
    const bruta = parseBRL(cells[2] ?? '0');
    if (bruta === 0) continue;
    declaracoes.push({
      periodo,
      vlReceitaBruta:     bruta,
      vlReceitaComercio:  0,
      vlReceitaIndustria: 0,
      vlReceitaServicos:  0,
      vlDas:              null,
      situacaoDeclaracao: 'TRANSMITIDA',
    });
  }
  return declaracoes;
}

function extrairCelulas(trInner: string): string[] {
  const cells: string[] = [];
  const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = cellRegex.exec(trInner)) !== null) {
    cells.push(stripTags(m[1] ?? ''));
  }
  return cells;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Converte "MM/AAAA" ou "AAAA-MM" → "AAAA-MM". */
function normalizarPeriodo(raw: string): string | null {
  // MM/AAAA
  const m1 = /^(\d{2})\/(\d{4})$/.exec(raw.trim());
  if (m1) return `${m1[2]}-${m1[1]}`;
  // AAAA-MM
  const m2 = /^(\d{4})-(\d{2})$/.exec(raw.trim());
  if (m2) return raw.trim();
  return null;
}

/** Converte valor monetário BR (ex: "1.234.567,89") em number. */
function parseBRL(s: string): number {
  const clean = s.replace(/[^\d,]/g, '').replace(',', '.');
  const n = parseFloat(clean);
  return Number.isNaN(n) ? 0 : n;
}

function normalizarSituacao(raw: string): string {
  const u = raw.toUpperCase();
  if (u.includes('RETIFI')) return 'RETIFICADA';
  if (u.includes('N') && u.includes('ENTREG')) return 'NAO_ENTREGUE';
  return 'TRANSMITIDA';
}
