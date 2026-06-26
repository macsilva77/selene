/**
 * Análise do inventário do Bloco H (sobre o resultado de parseEfdBlocoH).
 *
 * Responde, a partir da FOTO do estoque (sem depender de movimento):
 *   - Composição por propriedade (IND_PROP): próprio em meu poder × próprio em terceiros × de terceiros.
 *   - Estoque CONCILIÁVEL = só IND_PROP=0 (o que é meu e está comigo) → base do estoque fiscal.
 *   - Valor e mix por NCM, curva ABC e top itens.
 *   - Integridade (VL_INV declarado × Σ VL_ITEM) e alertas de qualidade.
 */
import type { Inventario, ItemInventario, MotivoInventario } from './efd-bloco-h.parser';

export const MOTIVO_INVENTARIO_LABEL: Record<MotivoInventario, string> = {
  '01': 'No final do período',
  '02': 'Mudança de forma de tributação da mercadoria (ICMS)',
  '03': 'Baixa cadastral / paralisação temporária',
  '04': 'Alteração de regime de pagamento',
  '05': 'Por determinação dos fiscos',
  '06': 'Substituição tributária (restituição/ressarcimento/complementação)',
};

const IND_PROP_LABEL = {
  '0': 'Próprio, em meu poder',
  '1': 'Próprio, em poder de terceiro',
  '2': 'De terceiro, em meu poder',
} as const;

export interface FaixaPropriedade {
  valor: number;
  qtdItens: number;
  percValor: number; // 0-1 sobre o valor total do inventário
}

export interface GrupoNcm {
  ncm: string;
  valor: number;
  qtdItens: number;
  percValor: number;
}

export interface ItemTopo {
  codItem: string;
  descricao: string;
  ncm: string;
  qtd: number;
  vlUnit: number;
  vlItem: number;
  indProp: ItemInventario['indProp'];
  indPropLabel: string;
}

export interface AnaliseEstoqueBlocoH {
  dtInv: string;
  motInv: MotivoInventario;
  motInvLabel: string;
  valorTotal: number;
  qtdItens: number;
  qtdItensDistintos: number;
  propriedade: {
    proprioEmPoder: FaixaPropriedade;     // IND_PROP 0
    proprioEmTerceiro: FaixaPropriedade;  // IND_PROP 1
    terceiroEmPoder: FaixaPropriedade;    // IND_PROP 2
  };
  estoqueConciliavel: number;             // soma valor IND_PROP 0
  porNcm: GrupoNcm[];                      // ordenado desc por valor
  curvaAbc: { a: FaixaPropriedade; b: FaixaPropriedade; c: FaixaPropriedade };
  topItens: ItemTopo[];
  integridade: {
    vlInvDeclarado: number;
    somaCalculada: number;
    diferenca: number;
    ok: boolean;
  };
  alertas: string[];
}

interface OpcoesAnalise {
  topN?: number;        // itens no ranking (default 10)
  topNcm?: number;      // grupos de NCM (default 10)
}

export function analisarInventario(inv: Inventario, opts: OpcoesAnalise = {}): AnaliseEstoqueBlocoH {
  const topN = opts.topN ?? 10;
  const topNcm = opts.topNcm ?? 10;
  const itens = inv.itens;
  const valorTotal = round2(itens.reduce((s, i) => s + i.vlItem, 0));

  const faixa = (pred: (i: ItemInventario) => boolean): FaixaPropriedade => {
    const sel = itens.filter(pred);
    const valor = round2(sel.reduce((s, i) => s + i.vlItem, 0));
    return { valor, qtdItens: sel.length, percValor: pct(valor, valorTotal) };
  };

  const proprioEmPoder = faixa(i => i.indProp === '0');
  const proprioEmTerceiro = faixa(i => i.indProp === '1');
  const terceiroEmPoder = faixa(i => i.indProp === '2');

  // ── por NCM ──
  const ncmMap = new Map<string, { valor: number; qtd: number }>();
  for (const i of itens) {
    const ncm = i.ncm || '(sem NCM)';
    const g = ncmMap.get(ncm) ?? { valor: 0, qtd: 0 };
    g.valor += i.vlItem; g.qtd += 1;
    ncmMap.set(ncm, g);
  }
  const porNcm: GrupoNcm[] = [...ncmMap.entries()]
    .map(([ncm, g]) => ({ ncm, valor: round2(g.valor), qtdItens: g.qtd, percValor: pct(g.valor, valorTotal) }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, topNcm);

  // ── curva ABC (por valor acumulado: A≤80%, B≤95%, C resto) ──
  const ordenados = [...itens].sort((a, b) => b.vlItem - a.vlItem);
  const grupoAbc = { a: vazia(), b: vazia(), c: vazia() };
  let acum = 0;
  for (const i of ordenados) {
    // a faixa é decidida pelo acumulado ANTES deste item (Pareto): o item que cruza
    // a fronteira pertence à faixa inferior — evita um grupo A vazio quando 1 item ≫ 80%.
    const pAntes = pct(acum, valorTotal);
    const alvo = pAntes < 0.8 ? grupoAbc.a : pAntes < 0.95 ? grupoAbc.b : grupoAbc.c;
    alvo.valor += i.vlItem; alvo.qtdItens += 1;
    acum += i.vlItem;
  }
  for (const k of ['a', 'b', 'c'] as const) {
    grupoAbc[k].valor = round2(grupoAbc[k].valor);
    grupoAbc[k].percValor = pct(grupoAbc[k].valor, valorTotal);
  }

  // ── top itens ──
  const topItens: ItemTopo[] = ordenados.slice(0, topN).map(i => ({
    codItem: i.codItem,
    descricao: i.descricao,
    ncm: i.ncm,
    qtd: i.qtd,
    vlUnit: i.vlUnit,
    vlItem: round2(i.vlItem),
    indProp: i.indProp,
    indPropLabel: IND_PROP_LABEL[i.indProp],
  }));

  const codigosDistintos = new Set(itens.map(i => i.codItem));

  return {
    dtInv: inv.dtInv,
    motInv: inv.motInv,
    motInvLabel: MOTIVO_INVENTARIO_LABEL[inv.motInv],
    valorTotal,
    qtdItens: itens.length,
    qtdItensDistintos: codigosDistintos.size,
    propriedade: { proprioEmPoder, proprioEmTerceiro, terceiroEmPoder },
    estoqueConciliavel: proprioEmPoder.valor,
    porNcm,
    curvaAbc: grupoAbc,
    topItens,
    integridade: {
      vlInvDeclarado: inv.vlInvDeclarado,
      somaCalculada: inv.somaVlItem,
      diferenca: round2(inv.somaVlItem - inv.vlInvDeclarado),
      ok: inv.integridadeOk,
    },
    alertas: gerarAlertas(inv),
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function gerarAlertas(inv: Inventario): string[] {
  const a: string[] = [];
  if (!inv.integridadeOk) {
    a.push(`Integridade: VL_INV declarado (${fmt(inv.vlInvDeclarado)}) ≠ Σ VL_ITEM (${fmt(inv.somaVlItem)}).`);
  }
  const semCat = inv.itens.filter(i => i.semCatalogo).length;
  if (semCat > 0) a.push(`${semCat} item(ns) sem cadastro no 0200 (sem descrição/NCM).`);

  const vlUnitZero = inv.itens.filter(i => i.qtd > 0 && i.vlUnit === 0).length;
  if (vlUnitZero > 0) a.push(`${vlUnitZero} item(ns) com quantidade > 0 e valor unitário zerado.`);

  const qtdNeg = inv.itens.filter(i => i.qtd < 0).length;
  if (qtdNeg > 0) a.push(`${qtdNeg} item(ns) com quantidade negativa.`);

  const terceiroSemPart = inv.itens.filter(i => i.indProp !== '0' && !i.codPart).length;
  if (terceiroSemPart > 0) a.push(`${terceiroSemPart} item(ns) de/para terceiro sem COD_PART (obrigatório para IND_PROP 1 ou 2).`);

  const semNcm = inv.itens.filter(i => !i.ncm).length;
  if (semNcm > 0) a.push(`${semNcm} item(ns) sem NCM.`);

  return a;
}

function vazia(): FaixaPropriedade { return { valor: 0, qtdItens: 0, percValor: 0 }; }
function pct(parte: number, total: number): number { return total > 0 ? parte / total : 0; }
function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }
function fmt(n: number): string { return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
