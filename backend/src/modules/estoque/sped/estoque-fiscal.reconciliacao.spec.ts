/**
 * Testes do engine de reconciliação do estoque fiscal (duas fotos + movimento).
 */
import type { Inventario, ItemInventario } from './efd-bloco-h.parser';
import type { MovimentoC170, MovimentoItem } from './efd-movimento-c170.parser';
import { reconciliar, fotoDeInventario } from './estoque-fiscal.reconciliacao';

// ── helpers de fixture ──
function itemInv(codItem: string, qtd: number, vlItem: number, ncm = '11111111'): ItemInventario {
  return {
    codItem, descricao: `desc ${codItem}`, ncm, unid: 'UN', qtd,
    vlUnit: qtd ? vlItem / qtd : 0, vlItem, indProp: '0', codPart: null, participante: null,
    codCta: null, vlItemIr: null, semCatalogo: false,
  };
}
function inventario(data: string, itens: ItemInventario[]): Inventario {
  const soma = itens.reduce((s, i) => s + i.vlItem, 0);
  return { dtInv: data, motInv: '01', vlInvDeclarado: soma, somaVlItem: soma, integridadeOk: true, itens };
}
function movItem(codItem: string, entradaQtd: number, entradaVal: number, saidaQtd = 0, saidaVal = 0): MovimentoItem {
  return { codItem, descricao: `desc ${codItem}`, ncm: '11111111', unidInv: 'UN', entradaQtd, entradaVal, saidaQtd, saidaVal };
}
function movimento(itens: MovimentoItem[], temSaidaItemizada: boolean): MovimentoC170 {
  return {
    cnpj: '12345678000195', dtIni: '2024-01-01', dtFin: '2024-12-31',
    itens: new Map(itens.map(i => [i.codItem, i])), conversoes: new Map(), temSaidaItemizada,
  };
}

// ── Cenário DERIVADO (saída não itemizada) ──
// P1: ei100/1000 + compras200/2200 − ef80/880  → vendas 220 / R$2320
// P2: ei50/500  + compras0       − ef60/600    → vendas −10  ⇒ ESTOURO (ef > disponível)
// P3: ei0       + compras30/300  − ef10/100    → vendas 20 / R$200, movimentou sem EI
describe('reconciliar — modo DERIVADO', () => {
  const ini = fotoDeInventario(inventario('2023-12-31', [itemInv('P1', 100, 1000), itemInv('P2', 50, 500)]));
  const fim = fotoDeInventario(inventario('2024-12-31', [itemInv('P1', 80, 880), itemInv('P2', 60, 600), itemInv('P3', 10, 100)]));
  const mov = movimento([movItem('P1', 200, 2200), movItem('P3', 30, 300)], false);
  const r = reconciliar(ini, mov, fim);

  it('modo é DERIVADO', () => expect(r.modo).toBe('DERIVADO'));

  it('venda derivada de P1 = EI + Compras − EF', () => {
    const p1 = r.itens.find(i => i.codItem === 'P1')!;
    expect(p1.vendasQtd).toBeCloseTo(220, 3);
    expect(p1.vendasVal).toBeCloseTo(2320, 2);
    expect(p1.estouro).toBe(false);
  });

  it('P2 com EF > disponível → ESTOURO (venda negativa)', () => {
    const p2 = r.itens.find(i => i.codItem === 'P2')!;
    expect(p2.vendasQtd).toBeCloseTo(-10, 3);
    expect(p2.estouro).toBe(true);
    expect(p2.estouroQtd).toBeCloseTo(-10, 3);
  });

  it('P3 movimentou sem estoque inicial', () => {
    const p3 = r.itens.find(i => i.codItem === 'P3')!;
    expect(p3.movSemEi).toBe(true);
    expect(p3.vendasQtd).toBeCloseTo(20, 3);
  });

  it('índices de estoque', () => {
    expect(r.indices.estoqueInicial).toMatchObject({ codigos: 2, qtd: 150, valor: 1500 });
    expect(r.indices.comprados).toMatchObject({ codigos: 2, qtd: 230, valor: 2500 });
    expect(r.indices.estoqueFinal).toMatchObject({ codigos: 3, qtd: 150, valor: 1580 });
  });

  it('vendidos conta só venda positiva (P1, P3)', () => {
    expect(r.indices.vendidos.codigos).toBe(2);
    expect(r.indices.vendidos.valor).toBeCloseTo(2520, 2);
  });

  it('giro total = Σvendas ÷ estoque médio', () => {
    // (2320+200) / ((1500+1580)/2) = 2520/1540 = 1.636…
    expect(r.giroTotal).toBeCloseTo(1.64, 2);
  });

  it('estouro listado em pontos de atenção', () => {
    expect(r.pontosAtencao.estouro.map(i => i.codItem)).toContain('P2');
  });

  it('movSemEi em pontos de atenção', () => {
    expect(r.pontosAtencao.movSemEi.codigos).toBe(1);
  });
});

// ── Cenário MEDIDO (saída itemizada) ──
// P1: ei100 + compras50 − vendas200(medido) → efCalc = −50 ⇒ ESTOURO (vendeu mais que tinha)
describe('reconciliar — modo MEDIDO', () => {
  const ini = fotoDeInventario(inventario('2023-12-31', [itemInv('P1', 100, 1000)]));
  const fim = fotoDeInventario(inventario('2024-12-31', [itemInv('P1', 0, 0)]));
  const mov = movimento([movItem('P1', 50, 500, 200, 2400)], true);
  const r = reconciliar(ini, mov, fim);

  it('modo é MEDIDO', () => expect(r.modo).toBe('MEDIDO'));

  it('usa venda medida do C170', () => {
    const p1 = r.itens.find(i => i.codItem === 'P1')!;
    expect(p1.vendasQtd).toBeCloseTo(200, 3);
    expect(p1.vendasVal).toBeCloseTo(2400, 2);
  });

  it('efCalc negativo → estouro (vendeu mais que o disponível)', () => {
    const p1 = r.itens.find(i => i.codItem === 'P1')!;
    expect(p1.efCalcQtd).toBeCloseTo(-50, 3);
    expect(p1.estouro).toBe(true);
  });
});

describe('reconciliar — flags de qualidade', () => {
  it('item estanque (tem estoque, sem compra e sem venda)', () => {
    const ini = fotoDeInventario(inventario('2023-12-31', [itemInv('Q1', 10, 100)]));
    const fim = fotoDeInventario(inventario('2024-12-31', [itemInv('Q1', 10, 100)]));
    const mov = movimento([], false);
    const r = reconciliar(ini, mov, fim);
    const q1 = r.itens.find(i => i.codItem === 'Q1')!;
    expect(q1.estanque).toBe(true);
    expect(q1.semCompra).toBe(true);
  });
});
