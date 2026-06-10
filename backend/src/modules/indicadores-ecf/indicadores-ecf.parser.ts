/**
 * Parser ECF para extração de indicadores econômico-fiscais:
 * faturamento declarado, prejuízo fiscal acumulado e base negativa de CSLL.
 * Encoding esperado: Latin-1 (ISO-8859-1).
 */

export interface EcfIndicadoresResult {
  razaoSocial: string;
  cnpj: string;
  anoCalendario: number;
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
  // Tenta DT_INI primeiro
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
  let anoCalendario: number;
  let formaTributacao = 'nao_identificado';
  let dtIni = '';
  let dtFin = '';

  // Faturamento Lucro Real: maior valor de crédito da DRE (L300)
  let maxCreditoL300 = 0;
  // Faturamento Lucro Presumido/Arbitrado: soma de VL_RECITA_BRUTA (P200)
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

    if (rec === '0000' && campos.length >= 9) {
      razaoSocial = (campos[7] ?? '').trim();
      const cnpjRaw = (campos[8] ?? '').trim().replace(/\D/g, '');
      cnpj = cnpjRaw.padStart(14, '0');
      dtIni = (campos[5] ?? '').trim();
      dtFin = (campos[6] ?? '').trim();
    } else if (rec === '0010' && campos.length >= 5) {
      const indFormaTrib = (campos[4] ?? '').trim();
      formaTributacao = IND_FORMA_TRIB_MAP[indFormaTrib] ?? 'nao_identificado';
      isLucroReal = formaTributacao === 'lucro_real';
    } else if (rec === 'L300' && campos.length >= 7) {
      // L300: |REG|NUM_ORD|COD_AGL|DESC_AGL|IND_DC|VL_CTA|
      // fields[0]='' fields[1]=REG fields[2]=NUM_ORD fields[3]=COD_AGL fields[4]=DESC_AGL fields[5]=IND_DC fields[6]=VL_CTA
      const indDc = (campos[5] ?? '').trim();
      const vlCta = parseValorBr(campos[6] ?? '');
      if (indDc === 'C' && vlCta > maxCreditoL300) {
        maxCreditoL300 = vlCta;
      }
    } else if (rec === 'P200' && campos.length >= 4) {
      // P200: |REG|PER_APU|VL_RECITA_BRUTA|VL_BASE_CALC|...
      // fields[0]='' fields[1]=REG fields[2]=PER_APU fields[3]=VL_RECITA_BRUTA
      somaP200 += parseValorBr(campos[3] ?? '');
    } else if (rec === 'M010' && campos.length >= 5) {
      // M010: |REG|COD_CONTA|DESC_CONTA|TIPO_CONTA|SLD_INI|IND_DC_SLD_INI|...
      // fields[0]='' fields[1]=REG fields[2]=COD_CONTA fields[3]=DESC_CONTA fields[4]=TIPO_CONTA
      const codConta = (campos[2] ?? '').trim();
      const tipoConta = (campos[4] ?? '').trim();
      if (codConta) {
        m010Map.set(codConta, tipoConta);
      }
    } else if (rec === 'M500' && campos.length >= 5) {
      // M500: |REG|COD_CONTA|VL_SLD_FIN|IND_DC_SLD_FIN|...
      // fields[0]='' fields[1]=REG fields[2]=COD_CONTA fields[3]=VL_SLD_FIN fields[4]=IND_DC_SLD_FIN
      const codConta = (campos[2] ?? '').trim();
      const vlSldFin = parseValorBr(campos[3] ?? '');
      const indDcSldFin = (campos[4] ?? '').trim();

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

  anoCalendario = extrairAnoCalendario(dtIni, dtFin);

  const faturamentoDeclarado = isLucroReal ? maxCreditoL300 : somaP200;

  return {
    razaoSocial,
    cnpj,
    anoCalendario,
    formaTributacao,
    faturamentoDeclarado,
    prejuizoFiscalAcumulado: prejuizoFiscal,
    baseNegativaCsll,
  };
}
