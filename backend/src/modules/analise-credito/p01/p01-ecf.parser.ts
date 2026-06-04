/**
 * Parser SPED ECF — extrai L100 (balanço referencial), L300 (DRE),
 * M300 (adições LALUR), M350 (exclusões LALUR) e regime tributário.
 * Encoding esperado: Latin-1 (ISO-8859-1).
 */

export type RegistroEcfBP  = 'L100' | 'P100' | 'U100';
export type RegistroEcfDRE = 'L300' | 'P150' | 'U150';
export type RegistroEcfLalur = 'M300' | 'M350';

export interface EcfRegistroRow {
  registroEcf: string;
  linhaCodigo: string;
  descricao:   string;
  valor:       number;
  status:      string;
}

export type RegimeTributario =
  | 'lucro_real' | 'lucro_presumido' | 'lucro_arbitrado'
  | 'imune_isenta' | 'simples_nacional';

export interface EcfParseResult {
  razaoSocial:      string;
  cnpjArquivo:      string;
  regimeTributario: RegimeTributario | null;
  registros:        EcfRegistroRow[];
  inconsistencias:  Array<{ tipoErro: string; descricao: string; severidade: string }>;
}

// ECF 0000[6] → regime  (IND_TRIB: 0=LR, 1=LP, 2=LA, 3=II)
const IND_TRIB_MAP: Record<string, RegimeTributario> = {
  '0': 'lucro_real', '1': 'lucro_presumido',
  '2': 'lucro_arbitrado', '3': 'imune_isenta',
};

// ECF 0010[4] → regime  (IND_FORMA_TRIB: T/R=LR, P=LP, A=LA, I/N=II, S=SN)
const IND_FORMA_TRIB_MAP: Record<string, RegimeTributario> = {
  'T': 'lucro_real', 'R': 'lucro_real', 'P': 'lucro_presumido',
  'A': 'lucro_arbitrado', 'I': 'imune_isenta',
  'N': 'imune_isenta', 'S': 'simples_nacional',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseValorBr(s: string): number {
  if (!s?.trim()) return 0;
  const v = parseFloat(s.trim().replaceAll('.', '').replace(',', '.'));
  return isNaN(v) ? 0 : v;
}

function parseLinha(linha: string): string[] | null {
  const l = linha.trim();
  if (!l.startsWith('|') || !l.endsWith('|')) return null;
  return l.slice(1, -1).split('|');
}

function valorComSinal(campos: string[], colVal: number, colDc: number, dcPositivo: string): number {
  const vl = parseValorBr(campos[colVal] ?? '');
  const dc = (campos[colDc] ?? dcPositivo).trim();
  return dc === dcPositivo ? vl : -vl;
}

// ─── Handlers por tipo de registro ───────────────────────────────────────────

// BP: L100 (Lucro Real) | P100 (Lucro Presumido/Arbitrado) | U100 (Imunes/Isentas)
// Sinal: D = positivo (saldo devedor → ativo), C = negativo
function processarBP(
  reg: RegistroEcfBP,
  campos: string[],
  registros: EcfRegistroRow[],
  incs: EcfParseResult['inconsistencias'],
) {
  if (campos.length < 8) return;
  const cod  = (campos[1] ?? '').trim();
  const desc = (campos[2] ?? '').trim();
  try {
    // Saldo final (cols 11/12) tem prioridade; fallback: saldo inicial (7/8)
    const [colVal, colDc] = campos.length >= 12 ? [11, 12] : [7, 8];
    const valor = valorComSinal(campos, colVal, colDc, 'D');
    registros.push({ registroEcf: reg, linhaCodigo: cod, descricao: desc, valor, status: 'ok' });
  } catch {
    incs.push({ tipoErro: `${reg}_PARSE`, descricao: `${reg} inválido: ${cod}`, severidade: 'alerta' });
  }
}

// DRE: L300 (Lucro Real) | P150 (Lucro Presumido/Arbitrado) | U150 (Imunes/Isentas)
// Sinal: C = positivo (receita), D = negativo (despesa/custo)
function processarDRE(
  reg: RegistroEcfDRE,
  campos: string[],
  registros: EcfRegistroRow[],
  incs: EcfParseResult['inconsistencias'],
) {
  if (campos.length < 8) return;
  const cod  = (campos[1] ?? '').trim();
  const desc = (campos[2] ?? '').trim();
  try {
    const valor = valorComSinal(campos, 7, 8, 'C');
    registros.push({ registroEcf: reg, linhaCodigo: cod, descricao: desc, valor, status: 'ok' });
  } catch {
    incs.push({ tipoErro: `${reg}_PARSE`, descricao: `${reg} inválido: ${cod}`, severidade: 'alerta' });
  }
}

function processarLalur(rec: 'M300' | 'M350', campos: string[], registros: EcfRegistroRow[]) {
  if (campos.length < 4) return;
  registros.push({
    registroEcf: rec,
    linhaCodigo: (campos[1] ?? '').trim(),
    descricao:   (campos[2] ?? '').trim(),
    valor:       parseValorBr(campos[3] ?? ''),
    status:      'ok',
  });
}

// ─── Tabela de dispatch ───────────────────────────────────────────────────────

type Handler = (campos: string[], registros: EcfRegistroRow[], incs: EcfParseResult['inconsistencias']) => void;

const HANDLERS: Record<string, Handler> = {
  L100: (c, r, i) => processarBP('L100',  c, r, i),
  P100: (c, r, i) => processarBP('P100',  c, r, i),
  U100: (c, r, i) => processarBP('U100',  c, r, i),
  L300: (c, r, i) => processarDRE('L300', c, r, i),
  P150: (c, r, i) => processarDRE('P150', c, r, i),
  U150: (c, r, i) => processarDRE('U150', c, r, i),
  M300: (c, r)    => processarLalur('M300', c, r),
  M350: (c, r)    => processarLalur('M350', c, r),
};

// ─── Parser principal ─────────────────────────────────────────────────────────

export function parseEcf(buffer: Buffer): EcfParseResult {
  const linhas = buffer.toString('latin1').split(/\r?\n/);

  let razaoSocial      = '';
  let cnpjArquivo      = '';
  let regimeTributario: RegimeTributario | null = null;
  const registros:      EcfRegistroRow[]                    = [];
  const inconsistencias: EcfParseResult['inconsistencias']  = [];

  for (const linha of linhas) {
    const campos = parseLinha(linha);
    if (!campos?.length) continue;
    const rec = campos[0];

    if (rec === '0000' && campos.length >= 5) {
      cnpjArquivo = (campos[3] ?? '').trim();
      razaoSocial = (campos[4] ?? '').trim();
      if (!regimeTributario)
        regimeTributario = IND_TRIB_MAP[(campos[6] ?? '').trim()] ?? null;

    } else if (rec === '0010' && campos.length >= 5) {
      // IND_FORMA_TRIB (pos 4) é a fonte primária de regime; sobrescreve 0000
      regimeTributario = IND_FORMA_TRIB_MAP[(campos[4] ?? '').trim()] ?? regimeTributario;

    } else {
      HANDLERS[rec]?.(campos, registros, inconsistencias);
    }
  }

  return { razaoSocial, cnpjArquivo, regimeTributario, registros, inconsistencias };
}
