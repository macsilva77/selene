/**
 * Parser ECF para extração de indicadores econômico-fiscais:
 * faturamento declarado, prejuízo fiscal acumulado e base negativa de CSLL.
 * Encoding esperado: Latin-1 (ISO-8859-1).
 *
 * Leiaute validado para COD_VER 0006 (2019) → 0012 (2025).
 *
 * 0000: |0000|LECF|COD_VER|CNPJ|NOME|...|...|...|...|DT_INI|DT_FIN|...|
 *          [0]  [1]   [2]   [3]  [4]  [5] [6] [7] [8]  [9]   [10]
 *
 * L300: |L300|COD_CTA|DS_CTA|IND_CTA|NIVEL|COD_CTA_REF|COD_CTA_SUP|VL_CTA|IND_DC|
 *          [0]  [1]    [2]     [3]    [4]      [5]         [6]       [7]    [8]
 *
 * P200: |P200|PER_APU|VL_REC_BRUTA|VL_BASE_CAL|...| (Lucro Presumido)
 *          [0]  [1]      [2]           [3]
 *
 * M010: |M010|COD_CONTA|DESC_CONTA|TIPO_CONTA|SLD_INI|IND_DC_SLD_INI|...|
 *          [0]   [1]       [2]       [3]         [4]        [5]
 *
 * M500: |M500|COD_CONTA|VL_SLD_FIN|IND_DC_SLD_FIN|...|
 *          [0]   [1]       [2]          [3]
 */

import {
  LinhaL300Bruta,
  somarReceitaBrutaL300,
} from '../../common/utils/ecf-l300-receita.util';

export interface EcfIndicadoresResult {
  razaoSocial: string;
  cnpj: string;
  anoCalendario: number;
  codVer: string;
  formaTributacao: string;
  faturamentoDeclarado: number;
  prejuizoFiscalAcumulado: number;
  baseNegativaCsll: number;
}

// ECF 0010[4] → regime (IND_FORMA_TRIB)
const IND_FORMA_TRIB_MAP: Record<string, string> = {
  T: 'lucro_real',
  R: 'lucro_real',
  P: 'lucro_presumido',
  A: 'lucro_arbitrado',
  I: 'imune_isenta',
  N: 'imune_isenta',
  S: 'simples_nacional',
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

/**
 * Extrai o ano calendário a partir das datas DT_INI ou DT_FIN.
 * Suporta DDMMAAAA e YYYYMMDD.
 */
function extrairAnoCalendario(dtIni: string, dtFin: string): number {
  for (const dt of [dtIni, dtFin]) {
    const s = dt?.trim();
    if (!s || s.length < 8) continue;
    // DDMMAAAA → ano nos últimos 4 dígitos
    const candidato1 = Number.parseInt(s.slice(4, 8), 10);
    // YYYYMMDD → ano nos primeiros 4 dígitos
    const candidato2 = Number.parseInt(s.slice(0, 4), 10);

    if (candidato1 >= 2000 && candidato1 <= 2100) return candidato1;
    if (candidato2 >= 2000 && candidato2 <= 2100) return candidato2;
  }
  return new Date().getFullYear();
}

// ─── Parser principal ─────────────────────────────────────────────────────────

export function parseEcfIndicadores(buffer: Buffer): EcfIndicadoresResult {
  const linhas = buffer.toString('latin1').split(/\r?\n/);

  let razaoSocial = '';
  let cnpj = '';
  let codVer = '';
  let formaTributacao = 'nao_identificado';
  let dtIni = '';
  let dtFin = '';

  // Lucro Real: acumula todas as linhas L300 (todos os trimestres) para somarReceitaBrutaL300
  const l300Linhas: LinhaL300Bruta[] = [];
  // Faturamento Lucro Presumido/Arbitrado: soma de VL_REC_BRUTA (P200)
  let somaP200 = 0;
  let isLucroReal = false;

  // Bloco M: mapa COD_CONTA → TIPO_CONTA (I=IRPJ, C=CSLL)
  const m010Map = new Map<string, string>();
  let prejuizoFiscal = 0;
  let baseNegativaCsll = 0;

  for (const linha of linhas) {
    const campos = parseLinha(linha);
    if (!campos?.length) continue;
    const rec = campos[0];

    // ── 0000: identificação e versão do leiaute ──────────────────────────────
    // Leiaute validado para COD_VER 0006→0012 (exercícios 2019→2025).
    // campos: [0]=0000 [1]=LECF [2]=COD_VER [3]=CNPJ [4]=NOME [5..8]=aux
    //         [9]=DT_INI [10]=DT_FIN
    if (rec === '0000' && campos.length >= 11) {
      codVer      = (campos[2] ?? '').trim();
      razaoSocial = (campos[4] ?? '').trim();
      // CNPJ não é lido aqui — o service usa o CNPJ do input externo
      dtIni = (campos[9]  ?? '').trim();
      dtFin = (campos[10] ?? '').trim();

    // ── 0010: forma de tributação ────────────────────────────────────────────
    } else if (rec === '0010' && campos.length >= 5) {
      const indFormaTrib = (campos[4] ?? '').trim();
      formaTributacao = IND_FORMA_TRIB_MAP[indFormaTrib] ?? 'nao_identificado';
      isLucroReal = formaTributacao === 'lucro_real';

    // ── L300: DRE — Lucro Real ───────────────────────────────────────────────
    // Leiaute (COD_VER 0006→0012 idêntico):
    // [0]=L300 [1]=COD_CTA [2]=DS_CTA [3]=IND_CTA [4]=NIVEL
    // [5]=COD_CTA_REF [6]=COD_CTA_SUP [7]=VL_CTA [8]=IND_DC
    } else if (rec === 'L300' && campos.length >= 9) {
      const indDc = (campos[8] ?? '').trim();

      // Guarda: coluna errada para esta versão → falha alto em vez de engolir como 0
      if (indDc !== 'D' && indDc !== 'C') {
        throw new Error(
          `L300 IND_DC inesperado '${indDc}' (COD_VER=${codVer}, COD_CTA=${campos[1]}) — ` +
          `verifique se o leiaute mudou além de COD_VER 0012`,
        );
      }

      const vlCta = parseValorBr(campos[7] ?? '');
      l300Linhas.push({ cod: (campos[1] ?? '').trim(), indDc, vlCta });

    // ── P200: apuração — Lucro Presumido ─────────────────────────────────────
    // Leiaute: [0]=P200 [1]=PER_APU [2]=VL_REC_BRUTA [3]=VL_BASE_CAL ...
    // Nota: sem arquivo Presumido no bucket para validação empírica (todos os
    // CNPJs ingeridos são Lucro Real). Layout conferido contra spec ECF RFB.
    } else if (rec === 'P200' && campos.length >= 3) {
      somaP200 += parseValorBr(campos[2] ?? '');

    // ── M010: mapa de contas LALUR/LACS ─────────────────────────────────────
    } else if (rec === 'M010' && campos.length >= 4) {
      const codConta = (campos[1] ?? '').trim();
      const tipoConta = (campos[3] ?? '').trim();
      if (codConta) {
        m010Map.set(codConta, tipoConta);
      }

    // ── M500: saldo final LALUR/LACS ─────────────────────────────────────────
    } else if (rec === 'M500' && campos.length >= 4) {
      const codConta    = (campos[1] ?? '').trim();
      const vlSldFin    = parseValorBr(campos[2] ?? '');
      const indDcSldFin = (campos[3] ?? '').trim();

      if (indDcSldFin === 'D' && vlSldFin > 0) {
        const tipoConta = m010Map.get(codConta) ?? '';
        if (tipoConta === 'I') {
          prejuizoFiscal += vlSldFin;
        } else if (tipoConta === 'C') {
          baseNegativaCsll += vlSldFin;
        }
      }
    }
  }

  const anoCalendario = extrairAnoCalendario(dtIni, dtFin);
  const faturamentoDeclarado = isLucroReal ? somarReceitaBrutaL300(l300Linhas) : somaP200;

  return {
    razaoSocial,
    cnpj,
    anoCalendario,
    codVer,
    formaTributacao,
    faturamentoDeclarado,
    prejuizoFiscalAcumulado: prejuizoFiscal,
    baseNegativaCsll,
  };
}
