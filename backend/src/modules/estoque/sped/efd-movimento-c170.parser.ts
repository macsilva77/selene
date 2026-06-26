/**
 * Parser do MOVIMENTO de itens (C170) do EFD ICMS/IPI — o "filme" do estoque.
 *
 * Fonte do leiaute: Guia Prático EFD-ICMS/IPI v3.2.2.
 *   C100 — documento fiscal     |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|...   (IND_OPER 0=entrada,1=saída)
 *   C170 — item do documento     |C170|NUM_ITEM|COD_ITEM|DESCR_COMPL|QTD|UNID|VL_ITEM|VL_DESC|IND_MOV|CST_ICMS|CFOP|...
 *   0200 — catálogo do item      |0200|COD_ITEM|DESCR_ITEM|...|UNID_INV|TIPO_ITEM|COD_NCM|...
 *   0220 — fatores de conversão  |0220|UNID_CONV|FAT_CONV|                              (filho do 0200)
 *   0000 — abertura              |0000|...|DT_INI|DT_FIN|NOME|CNPJ|...
 *
 * Regras: só conta C170 sob C100 com COD_SIT='00' (documento válido). Agrega por COD_ITEM
 * separando ENTRADAS (IND_OPER=0) de SAÍDAS (IND_OPER=1), em quantidade e valor.
 *
 * NOTA: nesta carteira a SAÍDA por item costuma NÃO existir no C170 (postos vendem por cupom;
 * não-postos só geram C170 nas entradas). Por isso a venda por item é DERIVADA na reconciliação
 * (ver estoque-fiscal.reconciliacao.ts), não lida daqui. O parser ainda captura saídas quando há.
 */
import { iterLines, parseNum, isoData } from './efd-bloco-h.parser';

export interface MovimentoItem {
  codItem: string;
  descricao: string;       // do 0200
  ncm: string;             // do 0200
  unidInv: string;         // UNID_INV do 0200 (unidade do inventário)
  entradaQtd: number;
  entradaVal: number;
  saidaQtd: number;
  saidaVal: number;
}

export interface FatorConversao {
  unidConv: string;        // unidade convertida (ex.: CX)
  fatConv: number;         // fator p/ a unidade de inventário
}

export interface MovimentoC170 {
  cnpj: string;
  dtIni: string;           // ISO
  dtFin: string;           // ISO
  itens: Map<string, MovimentoItem>;
  conversoes: Map<string, FatorConversao[]>; // COD_ITEM → fatores (0220)
  temSaidaItemizada: boolean;
}

const IDX_0000 = { DT_INI: 4, DT_FIN: 5, CNPJ: 7 } as const;
const IDX_0200 = { COD_ITEM: 2, DESCR: 3, UNID_INV: 6, NCM: 8 } as const;
const IDX_0220 = { UNID_CONV: 2, FAT_CONV: 3 } as const;
const IDX_C100 = { IND_OPER: 2, COD_SIT: 6 } as const;
const IDX_C170 = { COD_ITEM: 3, QTD: 5, VL_ITEM: 7 } as const;

/** Parseia UM arquivo EFD. Para o ano inteiro, ver agregarMovimentos(). */
export function parseEfdMovimentoC170(buffer: Buffer): MovimentoC170 {
  const cab = { cnpj: '', dtIni: '', dtFin: '' };
  const catalogo = new Map<string, { descr: string; ncm: string; unidInv: string }>();
  const conversoes = new Map<string, FatorConversao[]>();
  const itens = new Map<string, MovimentoItem>();
  let temSaidaItemizada = false;

  let indOper = '';        // do C100 corrente: '0' entrada, '1' saída
  let docValido = false;   // COD_SIT === '00'
  let codItem0200 = '';    // COD_ITEM do 0200 corrente (para anexar 0220)

  for (const raw of iterLines(buffer)) {
    const f = raw.split('|');
    const reg = f[1];

    switch (reg) {
      case '0000':
        cab.cnpj = (f[IDX_0000.CNPJ] ?? '').replace(/\D/g, '').padStart(14, '0');
        cab.dtIni = isoData(f[IDX_0000.DT_INI]);
        cab.dtFin = isoData(f[IDX_0000.DT_FIN]);
        break;

      case '0200':
        codItem0200 = (f[IDX_0200.COD_ITEM] ?? '').trim();
        if (codItem0200) {
          catalogo.set(codItem0200, {
            descr: (f[IDX_0200.DESCR] ?? '').trim(),
            ncm: (f[IDX_0200.NCM] ?? '').trim(),
            unidInv: (f[IDX_0200.UNID_INV] ?? '').trim(),
          });
        }
        break;

      case '0220': {
        if (!codItem0200) break;
        const lista = conversoes.get(codItem0200) ?? [];
        lista.push({ unidConv: (f[IDX_0220.UNID_CONV] ?? '').trim(), fatConv: parseNum(f[IDX_0220.FAT_CONV]) });
        conversoes.set(codItem0200, lista);
        break;
      }

      case 'C100':
        indOper = f[IDX_C100.IND_OPER] ?? '';
        docValido = (f[IDX_C100.COD_SIT] ?? '') === '00';
        break;

      case 'C170': {
        if (!docValido) break;
        const cod = (f[IDX_C170.COD_ITEM] ?? '').trim();
        if (!cod) break;
        const qtd = parseNum(f[IDX_C170.QTD]);
        const val = parseNum(f[IDX_C170.VL_ITEM]);
        const it = itens.get(cod) ?? novoItem(cod);
        if (indOper === '1') { it.saidaQtd += qtd; it.saidaVal += val; temSaidaItemizada = true; }
        else { it.entradaQtd += qtd; it.entradaVal += val; }
        itens.set(cod, it);
        break;
      }

      default:
        break;
    }
  }

  // enriquece com catálogo
  for (const [cod, it] of itens) {
    const cat = catalogo.get(cod);
    if (cat) { it.descricao = cat.descr; it.ncm = cat.ncm; it.unidInv = cat.unidInv; }
  }

  return { cnpj: cab.cnpj, dtIni: cab.dtIni, dtFin: cab.dtFin, itens, conversoes, temSaidaItemizada };
}

/** Soma vários meses (ou competências) num único movimento agregado por item. */
export function agregarMovimentos(movs: MovimentoC170[]): MovimentoC170 {
  const itens = new Map<string, MovimentoItem>();
  const conversoes = new Map<string, FatorConversao[]>();
  let temSaidaItemizada = false;
  let cnpj = '', dtIni = '', dtFin = '';

  for (const m of movs) {
    cnpj = cnpj || m.cnpj;
    dtIni = !dtIni || m.dtIni < dtIni ? m.dtIni : dtIni;
    dtFin = m.dtFin > dtFin ? m.dtFin : dtFin;
    temSaidaItemizada = temSaidaItemizada || m.temSaidaItemizada;
    for (const [cod, fatores] of m.conversoes) if (!conversoes.has(cod)) conversoes.set(cod, fatores);
    for (const [cod, src] of m.itens) {
      const it = itens.get(cod) ?? novoItem(cod);
      it.entradaQtd += src.entradaQtd; it.entradaVal += src.entradaVal;
      it.saidaQtd += src.saidaQtd; it.saidaVal += src.saidaVal;
      if (src.descricao && !it.descricao) it.descricao = src.descricao;
      if (src.ncm && !it.ncm) it.ncm = src.ncm;
      if (src.unidInv && !it.unidInv) it.unidInv = src.unidInv;
      itens.set(cod, it);
    }
  }
  return { cnpj, dtIni, dtFin, itens, conversoes, temSaidaItemizada };
}

function novoItem(codItem: string): MovimentoItem {
  return { codItem, descricao: '', ncm: '', unidInv: '', entradaQtd: 0, entradaVal: 0, saidaQtd: 0, saidaVal: 0 };
}
