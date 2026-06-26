/**
 * Reconciliação do ESTOQUE FISCAL — cruza duas fotos de Bloco H com o movimento (C170)
 * e fecha o ciclo pela identidade, por item:
 *
 *     Estoque Final = Estoque Inicial + Compras − Vendas
 *
 * Como a SAÍDA por item raramente existe no C170 (cupom nos postos; só-entrada nos demais),
 * a VENDA é DERIVADA: Vendas = EI + Compras − EF. Quando há saída itemizada, usa o medido.
 *
 * "Estouro" = quando a identidade fica negativa (a foto final excede o disponível, ou a venda
 * medida excede o que havia) → impossibilidade física a investigar.
 *
 * Premissa v1: unidade consistente entre foto e movimento (verdadeiro nesta carteira: combustível
 * em LT, geradores em UN). Normalização via 0220 fica para a fase de causa-raiz (F4).
 */
import type { Inventario } from './efd-bloco-h.parser';
import type { MovimentoC170 } from './efd-movimento-c170.parser';

const EPS = 0.001;

export type ModoReconciliacao = 'MEDIDO' | 'DERIVADO';

export interface ItemReconciliado {
  codItem: string;
  descricao: string;
  ncm: string;
  unid: string;
  eiQtd: number; eiVal: number;
  comprasQtd: number; comprasVal: number;
  vendasQtd: number; vendasVal: number;     // medido (MEDIDO) ou derivado (DERIVADO)
  efQtd: number; efVal: number;
  efCalcQtd: number;                         // EI + Compras − Vendas
  giro: number;
  estouro: boolean;
  estouroQtd: number;                        // negativo quando há estouro
  estouroVal: number;
  // flags de qualidade
  semEi: boolean; semEf: boolean; semCompra: boolean; semVenda: boolean;
  movSemEi: boolean; movSemEf: boolean; estanque: boolean;
}

export interface Indice { codigos: number; qtd: number; valor: number; }

export interface PontosAtencao {
  semCompra: Indice;
  semVenda: Indice;
  movSemEi: Indice;          // movimentou mas sem estoque inicial
  movSemEf: Indice;          // movimentou mas sem estoque final
  estouro: ItemReconciliado[]; // ordenado do mais negativo p/ o menos
}

export interface ResultadoReconciliacao {
  cnpj: string;
  modo: ModoReconciliacao;
  dtEstoqueInicial: string;
  dtEstoqueFinal: string;
  indices: {
    estoqueInicial: Indice;
    comprados: Indice;
    vendidos: Indice;
    estoqueFinal: Indice;
    movimentados: Indice;
  };
  giroTotal: number;
  pontosAtencao: PontosAtencao;
  itens: ItemReconciliado[];
}

interface FotoMap { data: string; itens: Map<string, { qtd: number; val: number; descricao: string; ncm: string; unid: string }>; }

/** Converte um Inventario (Bloco H) num mapa por COD_ITEM, somando duplicatas. */
export function fotoDeInventario(inv: Inventario | null): FotoMap {
  const itens = new Map<string, { qtd: number; val: number; descricao: string; ncm: string; unid: string }>();
  if (inv) {
    for (const it of inv.itens) {
      const cur = itens.get(it.codItem) ?? { qtd: 0, val: 0, descricao: it.descricao, ncm: it.ncm, unid: it.unid };
      cur.qtd += it.qtd; cur.val += it.vlItem;
      itens.set(it.codItem, cur);
    }
  }
  return { data: inv?.dtInv ?? '', itens };
}

export function reconciliar(
  fotoInicial: FotoMap,
  movimento: MovimentoC170,
  fotoFinal: FotoMap,
): ResultadoReconciliacao {
  const modo: ModoReconciliacao = movimento.temSaidaItemizada ? 'MEDIDO' : 'DERIVADO';

  const codigos = new Set<string>([
    ...fotoInicial.itens.keys(), ...fotoFinal.itens.keys(), ...movimento.itens.keys(),
  ]);

  const itens: ItemReconciliado[] = [];
  for (const cod of codigos) {
    const ei = fotoInicial.itens.get(cod);
    const ef = fotoFinal.itens.get(cod);
    const mov = movimento.itens.get(cod);

    const eiQtd = ei?.qtd ?? 0, eiVal = ei?.val ?? 0;
    const efQtd = ef?.qtd ?? 0, efVal = ef?.val ?? 0;
    const comprasQtd = mov?.entradaQtd ?? 0, comprasVal = mov?.entradaVal ?? 0;

    let vendasQtd: number, vendasVal: number;
    if (modo === 'MEDIDO') {
      vendasQtd = mov?.saidaQtd ?? 0;
      vendasVal = mov?.saidaVal ?? 0;
    } else {
      vendasQtd = round3(eiQtd + comprasQtd - efQtd);   // venda derivada
      vendasVal = round2(eiVal + comprasVal - efVal);
    }

    // identidade e estouro (unificado): disponível − dreno < 0 ⇒ estouro
    const dreno = modo === 'MEDIDO' ? vendasQtd : efQtd;
    const saldoResidual = round3(eiQtd + comprasQtd - dreno); // = efCalc (MEDIDO) ou vendaDerivada (DERIVADO)
    const efCalcQtd = round3(eiQtd + comprasQtd - vendasQtd);
    const estouro = saldoResidual < -EPS;
    const estouroQtd = estouro ? saldoResidual : 0;
    const estouroVal = estouro ? round2(eiVal + comprasVal - (modo === 'MEDIDO' ? vendasVal : efVal)) : 0;

    const estoqueMedioVal = (eiVal + efVal) / 2;
    const giro = estoqueMedioVal > EPS && vendasVal > 0 ? round2(vendasVal / estoqueMedioVal) : 0;

    const temMov = comprasQtd > EPS || Math.abs(vendasQtd) > EPS;
    const descricao = ei?.descricao || ef?.descricao || mov?.descricao || '';
    const ncm = ei?.ncm || ef?.ncm || mov?.ncm || '';
    const unid = ei?.unid || ef?.unid || mov?.unidInv || '';

    itens.push({
      codItem: cod, descricao, ncm, unid,
      eiQtd, eiVal, comprasQtd, comprasVal, vendasQtd, vendasVal, efQtd, efVal,
      efCalcQtd, giro, estouro, estouroQtd, estouroVal,
      semEi: eiQtd <= EPS, semEf: efQtd <= EPS, semCompra: comprasQtd <= EPS, semVenda: vendasQtd <= EPS,
      movSemEi: comprasQtd > EPS && eiQtd <= EPS,
      movSemEf: temMov && efQtd <= EPS,
      estanque: (eiQtd > EPS || efQtd > EPS) && comprasQtd <= EPS && Math.abs(vendasQtd) <= EPS,
    });
  }

  itens.sort((a, b) => b.efVal - a.efVal);

  // ── agregados ──
  const idx = (pred: (i: ItemReconciliado) => boolean, q: (i: ItemReconciliado) => number, v: (i: ItemReconciliado) => number): Indice => {
    const sel = itens.filter(pred);
    return { codigos: sel.length, qtd: round3(sel.reduce((s, i) => s + q(i), 0)), valor: round2(sel.reduce((s, i) => s + v(i), 0)) };
  };

  const indices = {
    estoqueInicial: idx(i => i.eiQtd > EPS, i => i.eiQtd, i => i.eiVal),
    comprados:      idx(i => i.comprasQtd > EPS, i => i.comprasQtd, i => i.comprasVal),
    vendidos:       idx(i => i.vendasQtd > EPS, i => i.vendasQtd, i => i.vendasVal),
    estoqueFinal:   idx(i => i.efQtd > EPS, i => i.efQtd, i => i.efVal),
    movimentados:   idx(i => i.comprasQtd > EPS || Math.abs(i.vendasQtd) > EPS, i => i.comprasQtd, i => i.comprasVal),
  };

  const somaEi = indices.estoqueInicial.valor, somaEf = indices.estoqueFinal.valor;
  const estoqueMedio = (somaEi + somaEf) / 2;
  const somaVendas = itens.reduce((s, i) => s + (i.vendasVal > 0 ? i.vendasVal : 0), 0);
  const giroTotal = estoqueMedio > EPS ? round2(somaVendas / estoqueMedio) : 0;

  const pontosAtencao: PontosAtencao = {
    semCompra: idx(i => (i.eiQtd > EPS || i.efQtd > EPS) && i.semCompra, i => i.efQtd, i => i.efVal),
    semVenda:  idx(i => (i.eiQtd > EPS || i.efQtd > EPS) && i.semVenda, i => i.efQtd, i => i.efVal),
    movSemEi:  idx(i => i.movSemEi, i => i.comprasQtd, i => i.comprasVal),
    movSemEf:  idx(i => i.movSemEf, i => i.comprasQtd, i => i.comprasVal),
    estouro:   itens.filter(i => i.estouro).sort((a, b) => a.estouroVal - b.estouroVal),
  };

  return {
    cnpj: movimento.cnpj,
    modo,
    dtEstoqueInicial: fotoInicial.data,
    dtEstoqueFinal: fotoFinal.data,
    indices,
    giroTotal,
    pontosAtencao,
    itens,
  };
}

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }
function round3(n: number): number { return Math.round((n + Number.EPSILON) * 1000) / 1000; }
