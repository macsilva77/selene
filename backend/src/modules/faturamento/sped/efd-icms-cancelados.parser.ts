/**
 * Extrator de documentos fiscais CANCELADOS do EFD ICMS/IPI.
 *
 * O parser de faturamento descarta cancelados (só acumula COD_SIT 00/01); aqui
 * fazemos o oposto: coletamos apenas os cancelados para análise de risco.
 *
 * Registros:
 *   0000 — competência (DT_INI)
 *   C100 — NF-e/NFC-e. COD_SIT 02=cancelado, 03=cancelado extemporâneo.
 *   C800 — CF-e SAT. COD_SIT 02/03 idem. (Sempre saída.)
 *
 * Cancelamento EXTEMPORÂNEO (03) = estorno lançado em período posterior ao da
 * emissão — sinal forte de manipulação retroativa de receita.
 */

import type { Readable } from 'node:stream';
import { iterLinesStream, parseBr } from '../../clientes-fornecedores/sped/efd-icms-ipi.parser';
import { extrairCompetencia } from './efd-icms-ipi-faturamento.parser';

// COD_SIT de cancelamento: 02=cancelado, 03=cancelado extemporâneo.
const COD_SIT_CANCELADO = new Set(['02', '03']);

const IDX_0000  = { DT_INI: 4 } as const;
// |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|VL_DOC|
const IDX_C100  = { IND_OPER: 2, COD_PART: 4, COD_MOD: 5, COD_SIT: 6, SER: 7, NUM_DOC: 8, CHV: 9, DT_DOC: 10, VL_DOC: 12 } as const;
// |C800|COD_MOD|COD_SIT|NUM_CFE|DT_DOC|VL_CFE|VL_PIS|VL_COFINS|CNPJ_CPF|NR_SAT|CHV_CFE|
const IDX_C800  = { COD_MOD: 2, COD_SIT: 3, NUM_CFE: 4, DT_DOC: 5, VL_CFE: 6, CHV: 11 } as const;

export interface DocCancelado {
  competencia:   string;          // AAAA-MM (do bloco 0000)
  tipo:          'NFe' | 'SAT';
  indOper:       '0' | '1';       // 0=entrada, 1=saída
  modelo:        string;          // COD_MOD
  serie:         string;
  numDoc:        string;
  chave:         string;
  dtDoc:         string;          // DDMMAAAA (do registro)
  codPart:       string;
  vlDoc:         number;
  codSit:        string;          // '02' | '03'
  extemporaneo:  boolean;         // codSit === '03'
}

/** Lê um EFD ICMS e retorna apenas os documentos cancelados (C100/C800). */
export async function parseEfdIcmsCancelados(stream: Readable): Promise<DocCancelado[]> {
  const docs: DocCancelado[] = [];
  let competencia = '';

  for await (const raw of iterLinesStream(stream)) {
    const f = raw.split('|');
    const reg = f[1];

    if (reg === '0000') {
      competencia = extrairCompetencia((f[IDX_0000.DT_INI] ?? '').trim());
    } else if (reg === 'C100') {
      const codSit = f[IDX_C100.COD_SIT] ?? '';
      if (!COD_SIT_CANCELADO.has(codSit)) continue;
      docs.push({
        competencia,
        tipo:    'NFe',
        indOper: (f[IDX_C100.IND_OPER] === '0' ? '0' : '1'),
        modelo:  (f[IDX_C100.COD_MOD] ?? '').trim(),
        serie:   (f[IDX_C100.SER] ?? '').trim(),
        numDoc:  (f[IDX_C100.NUM_DOC] ?? '').trim(),
        chave:   (f[IDX_C100.CHV] ?? '').trim(),
        dtDoc:   (f[IDX_C100.DT_DOC] ?? '').trim(),
        codPart: (f[IDX_C100.COD_PART] ?? '').trim(),
        vlDoc:   parseBr(f[IDX_C100.VL_DOC] ?? '0'),
        codSit,
        extemporaneo: codSit === '03',
      });
    } else if (reg === 'C800') {
      const codSit = f[IDX_C800.COD_SIT] ?? '';
      if (!COD_SIT_CANCELADO.has(codSit)) continue;
      docs.push({
        competencia,
        tipo:    'SAT',
        indOper: '1',                 // CF-e SAT é sempre saída (varejo)
        modelo:  (f[IDX_C800.COD_MOD] ?? '').trim(),
        serie:   '',
        numDoc:  (f[IDX_C800.NUM_CFE] ?? '').trim(),
        chave:   (f[IDX_C800.CHV] ?? '').trim(),
        dtDoc:   (f[IDX_C800.DT_DOC] ?? '').trim(),
        codPart: '',
        vlDoc:   parseBr(f[IDX_C800.VL_CFE] ?? '0'),
        codSit,
        extemporaneo: codSit === '03',
      });
    }
  }

  return docs;
}
