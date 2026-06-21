/**
 * Parser SPED ECF — extrai L100 (balanço referencial), L300 (DRE),
 * M300 (adições LALUR), M350 (exclusões LALUR) e regime tributário.
 * Encoding esperado: Latin-1 (ISO-8859-1).
 */

export type RegistroEcfBP  = 'L100' | 'P100' | 'U100';
export type RegistroEcfDRE = 'L300' | 'P150' | 'U150';
export type RegistroEcfLalur = 'M300' | 'M350';

export interface EcfRegistroRow {
  registroEcf:      string;
  trimestre:        number;        // 0 = anual/não-trimestral; 1..4 = Q1..Q4
  linhaCodigo:      string;
  descricao:        string;
  indCta:           'S' | 'A' | null; // Sintética / Analítica — campo [3] do L100
  nivel:            number | null;     // Nível hierárquico — campo [4] do L100
  saldoAnterior:    number;        // VL_INI — campo [7] do L100
  naturezaAnterior: string;        // IND_DC_INI — campo [8] do L100 ('D'|'C')
  totalDebitos:     number | null; // VL_DEB — campo [9] no formato estendido (13 campos)
  totalCreditos:    number | null; // VL_CRE — campo [10] no formato estendido (13 campos)
  valor:            number;        // VL_FIN — campo [11] estendido / [9] padrão
  naturezaFinal:    string;        // IND_DC_FIN — campo [12] estendido / [10] padrão
  status:           string;
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
  const v = Number.parseFloat(s.trim().replaceAll('.', '').replace(',', '.'));
  return Number.isNaN(v) ? 0 : v;
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

// Registros BP e DRE que têm entrega trimestral
const REGISTROS_TRIMESTRAIS = new Set(['L100','P100','U100','L300','P150','U150']);

// BP: L100 (Lucro Real) | P100 (Lucro Presumido/Arbitrado) | U100 (Imunes/Isentas)
// Sinal: D = positivo (saldo devedor → ativo), C = negativo
function processarBP(
  reg: RegistroEcfBP,
  campos: string[],
  trimestre: number,
  registros: EcfRegistroRow[],
  incs: EcfParseResult['inconsistencias'],
) {
  if (campos.length < 8) return;
  // Leiaute L100/P100/U100 (índices):
  //   [1]=COD_CTA  [2]=DS_CTA  [3]=IND_CTA(S/A)  [4]=NIVEL
  //   [7]=VAL_INI  [8]=IND_DC_INI  [9]=VAL_FIN  [10]=IND_DC_FIN
  //   Formato estendido (12+ campos): VAL_FIN=[11]  IND_DC_FIN=[12]
  const cod    = (campos[1] ?? '').trim();
  const desc   = (campos[2] ?? '').trim();
  const raw = campos[3]?.trim() ?? '';
  const indCta = (raw === 'S' || raw === 'A') ? raw : null;
  const nivel  = Number.parseInt(campos[4] ?? '', 10) || null;
  try {
    const extended = campos.length >= 12;
    const [colValFin, colDcFin] = extended ? [11, 12] : [9, 10];
    registros.push({
      registroEcf:      reg,
      trimestre,
      linhaCodigo:      cod,
      descricao:        desc,
      indCta,
      nivel,
      saldoAnterior:    parseValorBr(campos[7] ?? ''),
      naturezaAnterior: (campos[8] ?? 'D').trim() || 'D',
      totalDebitos:     extended ? parseValorBr(campos[9]  ?? '') : null,
      totalCreditos:    extended ? parseValorBr(campos[10] ?? '') : null,
      valor:            valorComSinal(campos, colValFin, colDcFin, 'D'),
      naturezaFinal:    (campos[colDcFin] ?? 'D').trim() || 'D',
      status:           'ok',
    });
  } catch {
    incs.push({ tipoErro: `${reg}_PARSE`, descricao: `${reg} inválido: ${cod}`, severidade: 'alerta' });
  }
}

// DRE: L300 (Lucro Real) | P150 (Lucro Presumido/Arbitrado) | U150 (Imunes/Isentas)
// Os três usam o MESMO layout referencial de 9 campos e a MESMA árvore 3.x.
// Sinal: C = positivo (receita), D = negativo (despesa/custo) via IND_DC.

// Contador para logar as primeiras 3 linhas L300 por arquivo (diagnóstico).
let _fase0DreRowCount = 0;

// COD_VER do registro 0000 (versão do leiaute ECF). Resolve os índices de campo
// do L300 de forma version-aware (leiaute >= 9 / AC2022+ introduziu NUM_ORD).
// Setado ao processar o 0000; um arquivo sempre começa por ele.
let _codVerLeiaute = 0;

function processarDRE(
  reg: RegistroEcfDRE,
  campos: string[],
  trimestre: number,
  registros: EcfRegistroRow[],
  incs: EcfParseResult['inconsistencias'],
) {
  try {
    // L300 (Real), P150 (Presumido/Arbitrado) e U150 (Imune/Isenta) compartilham o
    // MESMO layout referencial de 9 campos (AC2021+) e a MESMA árvore de códigos 3.x:
    // |REG|COD_CTA|DESC|IND_CTA(S/A)|NIVEL|COD_NAT|COD_CTA_SUP|VL_CTA|IND_DC|
    //   0     1     2       3          4      5         6         7      8
    // NUNCA usar cod=[2]/val=[3]: a suposição antiga (P150 de 4 campos, L300 de 6)
    // lia IND_CTA como valor e ZERAVA a DRE de Presumido/Imune.
    if (campos.length < 5) return;
    const novoLayout = campos.length >= 9;  // COD_NAT/COD_CTA_SUP presentes → VL=[7], IND_DC=[8]

    // Sanidade: COD_VER (0000) >= 9 deve trazer o layout completo de 9 campos.
    if (_codVerLeiaute >= 9 && !novoLayout) {
      incs.push({
        tipoErro:   `${reg}_LEIAUTE`,
        descricao:  `${reg} COD_VER=${_codVerLeiaute}: esperava 9 campos, veio ${campos.length}`,
        severidade: 'alerta',
      });
    }

    if (_fase0DreRowCount < 3) {
      console.log(
        `[FASE0-DRE] ${reg} campos (row ${_fase0DreRowCount + 1}/3, COD_VER=${_codVerLeiaute}, nFields=${campos.length}):\n` +
        campos.map((v, i) => `  [${i}]=${JSON.stringify(v)}`).join('\n'),
      );
      _fase0DreRowCount++;
    }

    const cod  = (campos[1] ?? '').trim();
    const desc = (campos[2] ?? '').trim();
    let valor: number;
    let naturezaFinal: string;
    if (novoLayout) {
      valor         = valorComSinal(campos, 7, 8, 'C');     // VL_CTA=[7], IND_DC=[8]
      naturezaFinal = (campos[8] ?? 'C').trim() || 'C';
    } else {
      // leiaute compacto |REG|COD|DESC|IND_DC|VL| → VL último, IND_DC penúltimo
      const vlIdx = campos.length - 1, dcIdx = campos.length - 2;
      valor         = valorComSinal(campos, vlIdx, dcIdx, 'C');
      naturezaFinal = (campos[dcIdx] ?? 'C').trim() || 'C';
    }

    registros.push({
      registroEcf:      reg,
      trimestre,
      linhaCodigo:      cod,
      descricao:        desc,
      indCta:           null,
      nivel:            null,
      saldoAnterior:    0,
      naturezaAnterior: 'C',
      totalDebitos:     null,
      totalCreditos:    null,
      valor,
      naturezaFinal,
      status:           'ok',
    });
  } catch {
    incs.push({ tipoErro: `${reg}_PARSE`, descricao: `${reg} inválido`, severidade: 'alerta' });
  }
}

function processarLalur(rec: 'M300' | 'M350', campos: string[], registros: EcfRegistroRow[]) {
  if (campos.length < 4) return;
  registros.push({
    registroEcf:      rec,
    trimestre:        0,
    linhaCodigo:      (campos[1] ?? '').trim(),
    descricao:        (campos[2] ?? '').trim(),
    indCta:           null, nivel: null,
    saldoAnterior:    0,    naturezaAnterior: 'D',
    totalDebitos:     null, totalCreditos: null,
    valor:            parseValorBr(campos[3] ?? ''),
    naturezaFinal:    'D',
    status:           'ok',
  });
}

// ─── Tabela de dispatch ───────────────────────────────────────────────────────

type Handler = (campos: string[], trimestre: number, registros: EcfRegistroRow[], incs: EcfParseResult['inconsistencias']) => void;

const HANDLERS: Record<string, Handler> = {
  L100: (c, t, r, i) => processarBP('L100',  c, t, r, i),
  P100: (c, t, r, i) => processarBP('P100',  c, t, r, i),
  U100: (c, t, r, i) => processarBP('U100',  c, t, r, i),
  L300: (c, t, r, i) => processarDRE('L300', c, t, r, i),
  P150: (c, t, r, i) => processarDRE('P150', c, t, r, i),
  U150: (c, t, r, i) => processarDRE('U150', c, t, r, i),
  M300: (c, _t, r)   => processarLalur('M300', c, r),
  M350: (c, _t, r)   => processarLalur('M350', c, r),
};

// ─── Parser principal ─────────────────────────────────────────────────────────

export function parseEcf(buffer: Buffer): EcfParseResult {
  const linhas = buffer.toString('latin1').split(/\r?\n/);

  let razaoSocial      = '';
  let cnpjArquivo      = '';
  let regimeTributario: RegimeTributario | null = null;
  const registros:      EcfRegistroRow[]                    = [];
  const inconsistencias: EcfParseResult['inconsistencias']  = [];

  // Rastreamento de trimestre: para registros BP/DRE, o arquivo ECF Lucro Real
  // contém 4 blocos consecutivos (Q1→Q4). Detectamos a mudança de trimestre
  // quando o código raiz '1' (ATIVO/início do plano) aparece novamente.
  let trimestreAtual = 0;
  let ultimoRec      = '';
  _codVerLeiaute     = 0;  // reset: estado de módulo; será setado pelo 0000 do arquivo atual

  for (const linha of linhas) {
    const campos = parseLinha(linha);
    if (!campos?.length) continue;
    const rec = campos[0];

    if (rec === '0000' && campos.length >= 5) {
      cnpjArquivo = (campos[3] ?? '').trim();
      razaoSocial = (campos[4] ?? '').trim();
      if (!regimeTributario)
        regimeTributario = IND_TRIB_MAP[(campos[6] ?? '').trim()] ?? null;
      // COD_VER_LC = campos[2] (versão do leiaute) → resolve índices L300 version-aware
      _codVerLeiaute = Number.parseInt((campos[2] ?? '').trim(), 10) || 0;
      // [FASE0-DRE] Logar versão do leiaute (COD_VER_LC = campos[2]) e total de campos
      _fase0DreRowCount = 0; // reset por arquivo
      console.log(`[FASE0-DRE] 0000: campos.length=${campos.length} COD_VER_LC=${campos[2]?.trim() ?? 'n/a'} CNPJ=${campos[3]?.trim() ?? 'n/a'}`);

    } else if (rec === '0010' && campos.length >= 5) {
      regimeTributario = IND_FORMA_TRIB_MAP[(campos[4] ?? '').trim()] ?? regimeTributario;

    } else if (HANDLERS[rec]) {
      // Detecta início de novo bloco trimestral: mesmo tipo de registro + código raiz '1'
      if (REGISTROS_TRIMESTRAIS.has(rec) && (campos[1] ?? '').trim() === '1') {
        if (rec === ultimoRec || trimestreAtual === 0) {
          trimestreAtual++;
        }
        ultimoRec = rec;
      }
      const trimestre = REGISTROS_TRIMESTRAIS.has(rec) ? trimestreAtual : 0;
      HANDLERS[rec]!(campos, trimestre, registros, inconsistencias);
    }
  }

  return { razaoSocial, cnpjArquivo, regimeTributario, registros, inconsistencias };
}
