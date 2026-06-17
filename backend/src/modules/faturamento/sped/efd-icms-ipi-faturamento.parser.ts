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
 */

import type { Readable } from 'node:stream';
import { iterLinesStream, parseBr } from '../../clientes-fornecedores/sped/efd-icms-ipi.parser';

export interface FatoCfop {
  cfop: string;
  vlOpr: number;
  qtd: number;
}

export interface FatoFaturamento {
  cnpj: string;
  razaoSocial: string;
  competencia: string;
  vlFaturamentoBruto: number;
  vlIcms: number;
  vlIpi: number;
  qtdDocumentos: number;
  vlComprasBruto: number;
  qtdDocumentosCompras: number;
  cfops: FatoCfop[];
}

// COD_SIT válidos: 00=normal, 01=extemporâneo. 07=denegado não é acumulado.
const VALID_COD_SIT = new Set(['00', '01']);

const IDX_0000 = { DT_INI: 4, NOME: 6, CNPJ: 7 } as const;
const IDX_C100 = { IND_OPER: 2, COD_SIT: 6, VL_DOC: 12, VL_IPI: 23 } as const;
const IDX_C190 = { CFOP: 3, VL_OPR: 5, VL_ICMS: 7 } as const;

// ─── Estado mutável durante o parse ──────────────────────────────────────────

interface ParseState {
  cnpj: string;
  razaoSocial: string;
  competencia: string;
  vlFaturamentoBruto: number;
  vlIpi: number;
  vlIcms: number;
  qtdDocumentos: number;
  vlComprasBruto: number;
  qtdDocumentosCompras: number;
  cfopMap: Map<string, { vlOpr: number; qtd: number }>;
  inValidSaida: boolean;
}

function processarReg0000(fields: string[], s: ParseState): void {
  s.razaoSocial = (fields[IDX_0000.NOME] ?? '').trim();
  const cnpjRaw = (fields[IDX_0000.CNPJ] ?? '').replace(/\D/g, '');
  s.cnpj        = cnpjRaw.padStart(14, '0');
  s.competencia = extrairCompetencia((fields[IDX_0000.DT_INI] ?? '').trim());
}

function processarC100(fields: string[], s: ParseState): void {
  const indOper = fields[IDX_C100.IND_OPER] ?? '';
  const valid   = VALID_COD_SIT.has(fields[IDX_C100.COD_SIT] ?? '');

  if (indOper === '1' && valid) {
    s.inValidSaida     = true;
    s.vlFaturamentoBruto += parseBr(fields[IDX_C100.VL_DOC] ?? '0');
    s.vlIpi              += parseBr(fields[IDX_C100.VL_IPI] ?? '0');
    s.qtdDocumentos      += 1;
  } else if (indOper === '0' && valid) {
    s.inValidSaida     = false;
    s.vlComprasBruto     += parseBr(fields[IDX_C100.VL_DOC] ?? '0');
    s.qtdDocumentosCompras += 1;
  } else {
    s.inValidSaida = false;
  }
}

function processarC190(fields: string[], s: ParseState): void {
  if (!s.inValidSaida) return;
  const cfop = (fields[IDX_C190.CFOP] ?? '').trim();
  if (!cfop) return;

  s.vlIcms += parseBr(fields[IDX_C190.VL_ICMS] ?? '0');
  const vlOpr = parseBr(fields[IDX_C190.VL_OPR] ?? '0');
  const entry = s.cfopMap.get(cfop) ?? { vlOpr: 0, qtd: 0 };
  entry.vlOpr += vlOpr;
  entry.qtd   += 1;
  s.cfopMap.set(cfop, entry);
}

// ─── Ponto de entrada ─────────────────────────────────────────────────────────

export async function parseEfdIcmsIpiFaturamento(stream: Readable): Promise<FatoFaturamento> {
  const s: ParseState = {
    cnpj: '', razaoSocial: '', competencia: '',
    vlFaturamentoBruto: 0, vlIpi: 0, vlIcms: 0,
    qtdDocumentos: 0, vlComprasBruto: 0, qtdDocumentosCompras: 0,
    cfopMap: new Map(),
    inValidSaida: false,
  };

  for await (const raw of iterLinesStream(stream)) {
    const fields = raw.split('|');
    const reg = fields[1];
    if      (reg === '0000') processarReg0000(fields, s);
    else if (reg === 'C100') processarC100(fields, s);
    else if (reg === 'C190') processarC190(fields, s);
  }

  const cfops: FatoCfop[] = [...s.cfopMap.entries()]
    .map(([cfop, d]) => ({ cfop, vlOpr: d.vlOpr, qtd: d.qtd }))
    .sort((a, b) => a.cfop.localeCompare(b.cfop));

  return {
    cnpj: s.cnpj, razaoSocial: s.razaoSocial, competencia: s.competencia,
    vlFaturamentoBruto: s.vlFaturamentoBruto, vlIcms: s.vlIcms, vlIpi: s.vlIpi,
    qtdDocumentos: s.qtdDocumentos, vlComprasBruto: s.vlComprasBruto,
    qtdDocumentosCompras: s.qtdDocumentosCompras, cfops,
  };
}

/** Converte DT_INI no formato DDMMAAAA para 'AAAA-MM'. */
export function extrairCompetencia(dtIni: string): string {
  if (dtIni.length < 8) return '';
  const mm   = dtIni.slice(2, 4);
  const aaaa = dtIni.slice(4, 8);
  if (Number.parseInt(aaaa, 10) < 2000) return '';
  return `${aaaa}-${mm}`;
}
