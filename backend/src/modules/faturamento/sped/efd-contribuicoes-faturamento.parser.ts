/**
 * Parser de EFD Contribuições — extração de receita de serviços para faturamento.
 *
 * Registros utilizados:
 *   0000 — Identificação (CNPJ, razão social, competência via DT_INI)
 *   A100 — NFS-e de serviços sujeitos ao ISS (Bloco A)
 *
 * Regras:
 *   IND_OPER = '1' + COD_SIT = '00' → saída válida
 *
 * Por que apenas A100?
 *   C100 da EFD Contribuições cobre as mesmas NF-e que o C100 da EFD ICMS/IPI.
 *   Para evitar dupla contagem, utilizamos apenas o Bloco A (serviços ISS),
 *   que é exclusivo desta obrigação (empresas prestadoras de serviços ISS
 *   não escrituram esses documentos no EFD ICMS/IPI).
 *
 * Layout (pipe-delimitado, latin1) — Guia Prático EFD Contribuições v1.36 (2024+):
 *   |0000|COD_VER|COD_FIN|DT_INI|DT_FIN|NOME|CNPJ|CPF|...|
 *   |A100|IND_OPER|IND_EMIT|COD_PART|COD_SIT|SER|SUB|NUM_DOC|CHV_NFE|DT_DOC|DT_EXE_SERV|
 *        VL_DOC|VL_DESC|VL_BC_PIS|ALIQ_PIS|VL_PIS|VL_BC_COFINS|ALIQ_COFINS|VL_COFINS|...|
 */

import { iterLines, parseBr } from '../../clientes-fornecedores/sped/efd-icms-ipi.parser';
import { extrairCompetencia } from './efd-icms-ipi-faturamento.parser';

export interface FatoFaturamentoContrib {
  cnpj: string;
  razaoSocial: string;
  /** Competência 'AAAA-MM' derivada de DT_INI do registro 0000. */
  competencia: string;
  /** Soma de VL_DOC dos A100 de saída válidos (IND_OPER=1, COD_SIT=00). */
  vlServicos: number;
  /** Soma de VL_PIS dos A100 de saída válidos. */
  vlPis: number;
  /** Soma de VL_COFINS dos A100 de saída válidos. */
  vlCofins: number;
  qtdDocumentosServicos: number;
}

// Índices após split('|') — fields[0] vazio, fields[1] = REG
// |0000|COD_VER|COD_FIN|DT_INI|DT_FIN|NOME|CNPJ|...
const IDX_0000 = { DT_INI: 4, NOME: 6, CNPJ: 7 } as const;

// |A100|IND_OPER|IND_EMIT|COD_PART|COD_SIT|SER|SUB|NUM_DOC|CHV_NFE|DT_DOC|DT_EXE_SERV|
//      VL_DOC|VL_DESC|VL_BC_PIS|ALIQ_PIS|VL_PIS|VL_BC_COFINS|ALIQ_COFINS|VL_COFINS|
//  [2]        [3]     [4]       [5]      [6]  [7]  [8]       [9]        [10]   [11]
//  [12]   [13]    [14]       [15]      [16]   [17]           [18]        [19]
const IDX_A100 = {
  IND_OPER: 2,
  COD_SIT: 5,
  VL_DOC: 12,
  VL_PIS: 16,
  VL_COFINS: 19,
} as const;

export function parseEfdContribuicoesFaturamento(buffer: Buffer): FatoFaturamentoContrib {
  let cnpj = '';
  let razaoSocial = '';
  let competencia = '';
  let vlServicos = 0;
  let vlPis = 0;
  let vlCofins = 0;
  let qtdDocumentosServicos = 0;

  for (const raw of iterLines(buffer)) {
    const fields = raw.split('|');
    const reg = fields[1];

    if (reg === '0000') {
      const dtIni = (fields[IDX_0000.DT_INI] ?? '').trim();
      razaoSocial = (fields[IDX_0000.NOME] ?? '').trim();
      const cnpjRaw = (fields[IDX_0000.CNPJ] ?? '').replace(/\D/g, '');
      cnpj = cnpjRaw.padStart(14, '0');
      competencia = extrairCompetencia(dtIni);

    } else if (reg === 'A100') {
      const indOper = fields[IDX_A100.IND_OPER] ?? '';
      const codSit = fields[IDX_A100.COD_SIT] ?? '';
      if (indOper !== '1' || codSit !== '00') continue;

      vlServicos += parseBr(fields[IDX_A100.VL_DOC] ?? '0');
      vlPis += parseBr(fields[IDX_A100.VL_PIS] ?? '0');
      vlCofins += parseBr(fields[IDX_A100.VL_COFINS] ?? '0');
      qtdDocumentosServicos += 1;
    }
  }

  return { cnpj, razaoSocial, competencia, vlServicos, vlPis, vlCofins, qtdDocumentosServicos };
}
