/**
 * Testes do parser de movimento (C170) + agregação multi-mês.
 */
import { parseEfdMovimentoC170, agregarMovimentos } from './efd-movimento-c170.parser';

function buf(lines: string[]): Buffer { return Buffer.from(lines.join('\n'), 'latin1'); }

// C100: |C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|...
const c100 = (indOper: string, codSit: string) => `|C100|${indOper}|1|PART|55|${codSit}|1|001|CHV|01012024|01012024|0|0|0|0|0|0|0|0|`;
// C170: |C170|NUM_ITEM|COD_ITEM|DESCR|QTD|UNID|VL_ITEM|...
const c170 = (cod: string, qtd: string, val: string) => `|C170|1|${cod}||${qtd}|UN|${val}|0|0|00|5102|`;

const EFD = buf([
  '|0000|017|0|01012024|31012024|EMPRESA|12345678000195||SP||||A|1|',
  '|0200|P1|PRODUTO UM|||UN|00|11111111||11||0||',
  '|0220|CX|12|',                       // P1: 1 CX = 12 UN
  '|0200|P2|PRODUTO DOIS|||UN|00|22222222||22||0||',
  c100('0', '00'), c170('P1', '100', '1000,00'), c170('P2', '50', '500,00'),  // entrada válida
  c100('1', '00'), c170('P1', '30', '360,00'),                                 // saída válida
  c100('0', '02'), c170('P1', '999', '9990,00'),                               // CANCELADO → ignora
]);

describe('parseEfdMovimentoC170', () => {
  const m = parseEfdMovimentoC170(EFD);

  it('cabeçalho do 0000', () => {
    expect(m.cnpj).toBe('12345678000195');
    expect(m.dtIni).toBe('2024-01-01');
    expect(m.dtFin).toBe('2024-01-31');
  });

  it('agrega entradas por item', () => {
    expect(m.itens.get('P1')!.entradaQtd).toBeCloseTo(100, 3);
    expect(m.itens.get('P1')!.entradaVal).toBeCloseTo(1000, 2);
    expect(m.itens.get('P2')!.entradaQtd).toBeCloseTo(50, 3);
  });

  it('agrega saídas por item e marca temSaidaItemizada', () => {
    expect(m.itens.get('P1')!.saidaQtd).toBeCloseTo(30, 3);
    expect(m.itens.get('P1')!.saidaVal).toBeCloseTo(360, 2);
    expect(m.temSaidaItemizada).toBe(true);
  });

  it('ignora C170 de documento cancelado (COD_SIT≠00)', () => {
    // P1 entrada seria 100+999 se não ignorasse o cancelado
    expect(m.itens.get('P1')!.entradaQtd).toBeCloseTo(100, 3);
  });

  it('enriquece descrição/NCM/unidInv do 0200', () => {
    expect(m.itens.get('P1')!.descricao).toBe('PRODUTO UM');
    expect(m.itens.get('P1')!.ncm).toBe('11111111');
    expect(m.itens.get('P1')!.unidInv).toBe('UN');
  });

  it('captura fatores de conversão 0220', () => {
    expect(m.conversoes.get('P1')).toEqual([{ unidConv: 'CX', fatConv: 12 }]);
  });

  it('sem saída itemizada → temSaidaItemizada false', () => {
    const so = parseEfdMovimentoC170(buf([
      '|0000|017|0|01012024|31012024|E|12345678000195||SP||||A|1|',
      '|0200|P1|X|||UN|00|11111111||||||',
      c100('0', '00'), c170('P1', '10', '100,00'),
    ]));
    expect(so.temSaidaItemizada).toBe(false);
    expect(so.itens.get('P1')!.saidaQtd).toBe(0);
  });
});

describe('agregarMovimentos', () => {
  it('soma o mesmo item ao longo de meses', () => {
    const jan = parseEfdMovimentoC170(buf([
      '|0000|017|0|01012024|31012024|E|12345678000195||SP||||A|1|',
      '|0200|P1|X|||UN|00|11111111||||||',
      c100('0', '00'), c170('P1', '100', '1000,00'),
    ]));
    const fev = parseEfdMovimentoC170(buf([
      '|0000|017|0|01022024|29022024|E|12345678000195||SP||||A|1|',
      '|0200|P1|X|||UN|00|11111111||||||',
      c100('0', '00'), c170('P1', '40', '420,00'),
    ]));
    const ag = agregarMovimentos([jan, fev]);
    expect(ag.itens.get('P1')!.entradaQtd).toBeCloseTo(140, 3);
    expect(ag.itens.get('P1')!.entradaVal).toBeCloseTo(1420, 2);
    expect(ag.dtIni).toBe('2024-01-01');
    expect(ag.dtFin).toBe('2024-02-29');
  });
});
