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
// COD_SIT válido: 00=regular, 01=extemporâneo. Base da taxa de cancelamento.
const COD_SIT_VALIDO = new Set(['00', '01']);

const IDX_0000  = { DT_INI: 4 } as const;
// |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|CHV_NFE|DT_DOC|DT_E_S|VL_DOC|
// IND_EMIT: 0=emissão própria, 1=terceiros. Só própria interessa (cancelamento da empresa).
const IDX_C100  = { IND_OPER: 2, IND_EMIT: 3, COD_PART: 4, COD_MOD: 5, COD_SIT: 6, SER: 7, NUM_DOC: 8, CHV: 9, DT_DOC: 10, VL_DOC: 12 } as const;
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

/** Resultado de um arquivo EFD: cancelados + base de válidos (mesma fonte → taxa consistente). */
export interface CanceladosArquivo {
  competencia:   string;          // AAAA-MM do arquivo
  docs:          DocCancelado[];   // cancelados de emissão própria
  validasSaida:  number;          // docs VÁLIDOS de saída própria (base da taxa)
}

/** C100 cancelado de EMISSÃO PRÓPRIA (IND_EMIT=0). Retorna null se não se aplica. */
function lerC100Cancelado(f: string[], competencia: string): DocCancelado | null {
  const codSit = f[IDX_C100.COD_SIT] ?? '';
  if (!COD_SIT_CANCELADO.has(codSit)) return null;
  // Só emissão própria; terceiros (IND_EMIT=1) = fornecedor cancelou, não conta.
  if ((f[IDX_C100.IND_EMIT] ?? '') !== '0') return null;
  return {
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
  };
}

/** C800 (CF-e SAT) cancelado — sempre emissão própria e saída (varejo). */
function lerC800Cancelado(f: string[], competencia: string): DocCancelado | null {
  const codSit = f[IDX_C800.COD_SIT] ?? '';
  if (!COD_SIT_CANCELADO.has(codSit)) return null;
  return {
    competencia,
    tipo:    'SAT',
    indOper: '1',
    modelo:  (f[IDX_C800.COD_MOD] ?? '').trim(),
    serie:   '',
    numDoc:  (f[IDX_C800.NUM_CFE] ?? '').trim(),
    chave:   (f[IDX_C800.CHV] ?? '').trim(),
    dtDoc:   (f[IDX_C800.DT_DOC] ?? '').trim(),
    codPart: '',
    vlDoc:   parseBr(f[IDX_C800.VL_CFE] ?? '0'),
    codSit,
    extemporaneo: codSit === '03',
  };
}

/** É saída própria VÁLIDA? (base da taxa) — C100 IND_EMIT=0/IND_OPER=1 ou C800 SAT. */
function ehValidaSaida(reg: string, f: string[]): boolean {
  if (reg === 'C100') {
    return (f[IDX_C100.IND_EMIT] ?? '') === '0'
        && (f[IDX_C100.IND_OPER] ?? '') === '1'
        && COD_SIT_VALIDO.has(f[IDX_C100.COD_SIT] ?? '');
  }
  if (reg === 'C800') return COD_SIT_VALIDO.has(f[IDX_C800.COD_SIT] ?? ''); // SAT = saída própria
  return false;
}

/**
 * Lê um EFD ICMS e retorna os cancelados de emissão própria + a contagem de
 * saídas próprias VÁLIDAS (base da taxa), tudo da mesma leitura para garantir
 * consistência (cancelados e base do mesmo conjunto de arquivos).
 */
export async function parseEfdIcmsCancelados(stream: Readable): Promise<CanceladosArquivo> {
  const docs: DocCancelado[] = [];
  let competencia = '';
  let validasSaida = 0;

  for await (const raw of iterLinesStream(stream)) {
    const f = raw.split('|');
    const reg = f[1];

    if (reg === '0000') {
      competencia = extrairCompetencia((f[IDX_0000.DT_INI] ?? '').trim());
    } else if (reg === 'C100') {
      const d = lerC100Cancelado(f, competencia);
      if (d) docs.push(d);
      else if (ehValidaSaida('C100', f)) validasSaida += 1;
    } else if (reg === 'C800') {
      const d = lerC800Cancelado(f, competencia);
      if (d) docs.push(d);
      else if (ehValidaSaida('C800', f)) validasSaida += 1;
    }
  }

  return { competencia, docs, validasSaida };
}
