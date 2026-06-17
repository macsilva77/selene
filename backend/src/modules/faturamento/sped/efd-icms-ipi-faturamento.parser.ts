/**
 * Parser de EFD ICMS/IPI — extração de faturamento mensal.
 *
 * Registros utilizados:
 *   0000 — Identificação (CNPJ, razão social, competência via DT_INI)
 *   C100 — Documentos fiscais (IND_OPER=1 → saídas, IND_OPER=0 → entradas/compras)
 *   C190 — Analítico por CFOP/CST (filho do C100 corrente)
 *
 * Regras:
 *   IND_OPER = '1' + COD_SIT em {'00','01'} → saída válida (faturamento)
 *   IND_OPER = '0' + COD_SIT em {'00','01'} → entrada válida (compras)
 *   COD_SIT '07'=denegado — nota rejeitada pela SEFAZ, NÃO acumulada
 *   C190 acumulado apenas enquanto o C100 pai é saída válida
 *
 * Layout (pipe-delimitado, latin1) — Guia Prático EFD ICMS/IPI v3.x (2024+):
 *   |0000|COD_VER|COD_FIN|DT_INI|DT_FIN|NOME|CNPJ|CPF|...|
 *   |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|VL_DOC|VL_ABAT_NT|VL_MERC|IND_FRT|VL_FRT|VL_SEG|VL_OUT_DA|VL_BC_ICMS|VL_ICMS|VL_BC_ICMS_ST|VL_ICMS_ST|VL_IPI|...|
 *   |C190|CST_ICMS|CFOP|ALIQ_ICMS|VL_OPR|VL_BC_ICMS|VL_ICMS|...|
 */

import { iterLines, parseBr } from '../../clientes-fornecedores/sped/efd-icms-ipi.parser';

export interface FatoCfop {
  cfop: string;
  vlOpr: number;
  qtd: number;
}

export interface FatoFaturamento {
  cnpj: string;
  razaoSocial: string;
  /** Competência 'AAAA-MM' derivada de DT_INI do registro 0000. */
  competencia: string;
  /** Soma de VL_DOC dos C100 de saída válidos (IND_OPER=1, COD_SIT=00/01). */
  vlFaturamentoBruto: number;
  /** Soma de VL_ICMS dos C190 de saída válidos. */
  vlIcms: number;
  /** Soma de VL_IPI dos C100 de saída válidos. */
  vlIpi: number;
  qtdDocumentos: number;
  /** Soma de VL_DOC dos C100 de entrada válidos (IND_OPER=0, COD_SIT=00/01). */
  vlComprasBruto: number;
  qtdDocumentosCompras: number;
  /** Breakdown por CFOP, ordenado por código. */
  cfops: FatoCfop[];
}

// COD_SIT válidos: 00=normal, 01=extemporâneo. 07=denegado não é acumulado.
const VALID_COD_SIT = new Set(['00', '01']);

// Índices após split('|') — fields[0] vazio (antes do primeiro |), fields[1] = REG
// |0000|COD_VER|COD_FIN|DT_INI|DT_FIN|NOME|CNPJ|CPF|...
const IDX_0000 = { DT_INI: 4, NOME: 6, CNPJ: 7 } as const;

// |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|
//      VL_DOC|VL_ABAT_NT|VL_MERC|IND_FRT|VL_FRT|VL_SEG|VL_OUT_DA|VL_BC_ICMS|VL_ICMS|
//      VL_BC_ICMS_ST|VL_ICMS_ST|VL_IPI|
const IDX_C100 = { IND_OPER: 2, COD_SIT: 6, VL_DOC: 12, VL_IPI: 23 } as const;

// |C190|CST_ICMS|CFOP|ALIQ_ICMS|VL_OPR|VL_BC_ICMS|VL_ICMS|
const IDX_C190 = { CFOP: 3, VL_OPR: 5, VL_ICMS: 7 } as const;

export function parseEfdIcmsIpiFaturamento(buffer: Buffer): FatoFaturamento {
  let cnpj = '';
  let razaoSocial = '';
  let competencia = '';
  let vlFaturamentoBruto = 0;
  let vlIpi = 0;
  let vlIcms = 0;
  let qtdDocumentos = 0;
  let vlComprasBruto = 0;
  let qtdDocumentosCompras = 0;
  const cfopMap = new Map<string, { vlOpr: number; qtd: number }>();

  let inValidSaida = false;

  for (const raw of iterLines(buffer)) {
    const fields = raw.split('|');
    const reg = fields[1];

    if (reg === '0000') {
      const dtIni = (fields[IDX_0000.DT_INI] ?? '').trim();
      razaoSocial = (fields[IDX_0000.NOME] ?? '').trim();
      const cnpjRaw = (fields[IDX_0000.CNPJ] ?? '').replace(/\D/g, '');
      cnpj = cnpjRaw.padStart(14, '0');
      competencia = extrairCompetencia(dtIni);

    } else if (reg === 'C100') {
      const indOper = fields[IDX_C100.IND_OPER] ?? '';
      const codSit = fields[IDX_C100.COD_SIT] ?? '';
      const valid = VALID_COD_SIT.has(codSit);

      if (indOper === '1' && valid) {
        inValidSaida = true;
        vlFaturamentoBruto += parseBr(fields[IDX_C100.VL_DOC] ?? '0');
        vlIpi += parseBr(fields[IDX_C100.VL_IPI] ?? '0');
        qtdDocumentos += 1;
      } else if (indOper === '0' && valid) {
        inValidSaida = false;
        vlComprasBruto += parseBr(fields[IDX_C100.VL_DOC] ?? '0');
        qtdDocumentosCompras += 1;
      } else {
        inValidSaida = false;
      }

    } else if (reg === 'C190') {
      if (!inValidSaida) continue;
      const cfop = (fields[IDX_C190.CFOP] ?? '').trim();
      if (!cfop) continue;

      vlIcms += parseBr(fields[IDX_C190.VL_ICMS] ?? '0');
      const vlOpr = parseBr(fields[IDX_C190.VL_OPR] ?? '0');
      const entry = cfopMap.get(cfop) ?? { vlOpr: 0, qtd: 0 };
      entry.vlOpr += vlOpr;
      entry.qtd += 1;
      cfopMap.set(cfop, entry);
    }
  }

  const cfops: FatoCfop[] = [];
  for (const [cfop, data] of cfopMap) {
    cfops.push({ cfop, vlOpr: data.vlOpr, qtd: data.qtd });
  }
  cfops.sort((a, b) => a.cfop.localeCompare(b.cfop));

  return {
    cnpj,
    razaoSocial,
    competencia,
    vlFaturamentoBruto,
    vlIcms,
    vlIpi,
    qtdDocumentos,
    vlComprasBruto,
    qtdDocumentosCompras,
    cfops,
  };
}

/** Converte DT_INI no formato DDMMAAAA para 'AAAA-MM'. */
export function extrairCompetencia(dtIni: string): string {
  if (dtIni.length < 8) return '';
  const mm = dtIni.slice(2, 4);
  const aaaa = dtIni.slice(4, 8);
  if (Number.parseInt(aaaa, 10) < 2000) return '';
  return `${aaaa}-${mm}`;
}
