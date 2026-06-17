/**
 * Parser de EFD Contribuições — extração de receita de serviços para faturamento.
 *
 * Registros utilizados:
 *   0000 — Identificação (CNPJ, razão social, competência via DT_INI)
 *   A100 — NFS-e de serviços sujeitos ao ISS (Bloco A)
 *
 * Por que apenas A100?
 *   C100 da EFD Contribuições cobre as mesmas NF-e que o C100 da EFD ICMS/IPI.
 *   Para evitar dupla contagem, utilizamos apenas o Bloco A (serviços ISS),
 *   que é exclusivo desta obrigação.
 */

import type { Readable } from 'node:stream';
import { iterLinesStream, parseBr } from '../../clientes-fornecedores/sped/efd-icms-ipi.parser';
import { extrairCompetencia } from './efd-icms-ipi-faturamento.parser';

export interface FatoFaturamentoContrib {
  cnpj: string;
  razaoSocial: string;
  competencia: string;
  vlServicos: number;
  vlPis: number;
  vlCofins: number;
  qtdDocumentosServicos: number;
}

const IDX_0000 = { DT_INI: 4, NOME: 6, CNPJ: 7 } as const;

// |A100|IND_OPER|IND_EMIT|COD_PART|COD_SIT|SER|SUB|NUM_DOC|CHV_NFE|DT_DOC|DT_EXE_SERV|
//      VL_DOC  |VL_DESC |VL_BC_PIS|ALIQ_PIS|VL_PIS|VL_BC_COFINS|ALIQ_COFINS|VL_COFINS|
const IDX_A100 = { IND_OPER: 2, COD_SIT: 5, VL_DOC: 12, VL_PIS: 16, VL_COFINS: 19 } as const;

export async function parseEfdContribuicoesFaturamento(stream: Readable): Promise<FatoFaturamentoContrib> {
  let cnpj = '';
  let razaoSocial = '';
  let competencia = '';
  let vlServicos = 0;
  let vlPis = 0;
  let vlCofins = 0;
  let qtdDocumentosServicos = 0;

  for await (const raw of iterLinesStream(stream)) {
    const fields = raw.split('|');
    const reg = fields[1];

    if (reg === '0000') {
      razaoSocial = (fields[IDX_0000.NOME] ?? '').trim();
      const cnpjRaw = (fields[IDX_0000.CNPJ] ?? '').replace(/\D/g, '');
      cnpj        = cnpjRaw.padStart(14, '0');
      competencia = extrairCompetencia((fields[IDX_0000.DT_INI] ?? '').trim());

    } else if (reg === 'A100') {
      if (fields[IDX_A100.IND_OPER] !== '1' || fields[IDX_A100.COD_SIT] !== '00') continue;
      vlServicos += parseBr(fields[IDX_A100.VL_DOC]    ?? '0');
      vlPis      += parseBr(fields[IDX_A100.VL_PIS]    ?? '0');
      vlCofins   += parseBr(fields[IDX_A100.VL_COFINS] ?? '0');
      qtdDocumentosServicos += 1;
    }
  }

  return { cnpj, razaoSocial, competencia, vlServicos, vlPis, vlCofins, qtdDocumentosServicos };
}
