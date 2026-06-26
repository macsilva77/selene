/**
 * Testes do parser do Bloco 1300 (combustíveis) + análise.
 */
import { parseEfdBloco1300, agregarCombustivel } from './efd-bloco1300-combustivel.parser';
import { analisarCombustivel } from './estoque-combustivel.analise';

function buf(lines: string[]): Buffer { return Buffer.from(lines.join('\n'), 'latin1'); }

// 1300: |1300|COD_ITEM|DT_FECH|ESTQ_ABERT|VOL_ENTR|VOL_DISP|VOL_SAIDAS|ESTQ_ESCR|VAL_AJ_PERDA|VAL_AJ_GANHO|FECH_FISICO|
const r1300 = (cod: string, dt: string, abert: string, entr: string, saidas: string, perda: string, ganho: string, fech: string) =>
  `|1300|${cod}|${dt}|${abert}|${entr}|0|${saidas}|0|${perda}|${ganho}|${fech}|`;
// 1310: |1310|NUM_TANQUE|ESTQ_ABERT|VOL_ENTR|VOL_DISP|VOL_SAIDAS|ESTQ_ESCR|VAL_AJ_PERDA|VAL_AJ_GANHO|FECH_FISICO|CAP_TANQUE|
const r1310 = (tq: string, saidas: string, perda: string, fech: string, cap: string) =>
  `|1310|${tq}|0|0|0|${saidas}|0|${perda}|0|${fech}|${cap}|`;

// 2 dias de gasolina: abertura 1000, +5000 −5800 perda 10 ganho 5 → fecha 195; depois 195 +6000 −6100 → fecha 90
const EFD = buf([
  '|0000|017|0|01012024|31012024|POSTO|12345678000195||SP||||A|1|',
  '|0200|GAS|GASOLINA COMUM|||LT|00|27101259||||||',
  '|0200|ETA|ETANOL|||LT|00|22071090||||||',
  r1300('GAS', '01012024', '1000', '5000', '5800', '10', '5', '195'),
  r1300('GAS', '02012024', '195', '6000', '6100', '8', '3', '90'),
  r1300('ETA', '01012024', '500', '3000', '3200', '5', '2', '297'),
  r1310('TANQUE1', '5800', '10', '195', '15000'),
]);

describe('parseEfdBloco1300', () => {
  const m = parseEfdBloco1300(EFD);

  it('marca temBloco1300', () => expect(m.temBloco1300).toBe(true));
  it('cabeçalho', () => { expect(m.cnpj).toBe('12345678000195'); expect(m.dtIni).toBe('2024-01-01'); });

  it('agrega GAS: entradas, vendas, perda, ganho', () => {
    const g = m.combustiveis.get('GAS')!;
    expect(g.dias).toBe(2);
    expect(g.volEntradas).toBeCloseTo(11000, 3);
    expect(g.volSaidas).toBeCloseTo(11900, 3);
    expect(g.perda).toBeCloseTo(18, 3);
    expect(g.ganho).toBeCloseTo(8, 3);
  });

  it('abertura = 1º dia, fechamento físico = último dia', () => {
    const g = m.combustiveis.get('GAS')!;
    expect(g.estqAbertura).toBeCloseTo(1000, 3);   // dia 01
    expect(g.estqFechamento).toBeCloseTo(90, 3);   // dia 02
  });

  it('descrição/NCM do 0200', () => {
    expect(m.combustiveis.get('GAS')!.descricao).toBe('GASOLINA COMUM');
    expect(m.combustiveis.get('GAS')!.ncm).toBe('27101259');
  });

  it('tanque 1310 agregado', () => {
    const t = m.tanques.get('TANQUE1')!;
    expect(t.volSaidas).toBeCloseTo(5800, 3);
    expect(t.capacidade).toBeCloseTo(15000, 3);
  });
});

describe('agregarCombustivel — multi-mês', () => {
  it('soma meses e mantém abertura do 1º e fechamento do último', () => {
    const jan = parseEfdBloco1300(EFD);
    const fev = parseEfdBloco1300(buf([
      '|0000|017|0|01022024|29022024|POSTO|12345678000195||SP||||A|1|',
      '|0200|GAS|GASOLINA COMUM|||LT|00|27101259||||||',
      r1300('GAS', '15022024', '90', '4000', '3900', '5', '2', '187'),
    ]));
    const ag = agregarCombustivel([jan, fev]);
    const g = ag.combustiveis.get('GAS')!;
    expect(g.estqAbertura).toBeCloseTo(1000, 3); // jan/01
    expect(g.estqFechamento).toBeCloseTo(187, 3); // fev/15
    expect(g.volSaidas).toBeCloseTo(11900 + 3900, 3);
  });
});

describe('analisarCombustivel', () => {
  const a = analisarCombustivel(parseEfdBloco1300(EFD));

  it('ordena por venda desc (GAS antes de ETA)', () => {
    expect(a.combustiveis[0].codItem).toBe('GAS');
  });

  it('totais', () => {
    expect(a.totalVendas).toBeCloseTo(11900 + 3200, 3);
    expect(a.totalPerda).toBeCloseTo(18 + 5, 3);
  });

  it('perda% = perda ÷ (abertura + entradas)', () => {
    const g = a.combustiveis.find(c => c.codItem === 'GAS')!;
    // perda 18 / (1000 + 11000) = 0.0015
    expect(g.perdaPercent).toBeCloseTo(0.0015, 4);
  });

  it('quebra líquida = ganho − perda', () => {
    const g = a.combustiveis.find(c => c.codItem === 'GAS')!;
    expect(g.quebraLiquida).toBeCloseTo(8 - 18, 3);
  });

  it('alerta de perda alta quando acima de 0,6%', () => {
    const alta = analisarCombustivel(parseEfdBloco1300(buf([
      '|0000|017|0|01012024|31012024|P|12345678000195||SP||||A|1|',
      '|0200|GAS|GASOLINA|||LT|00|27101259||||||',
      r1300('GAS', '01012024', '1000', '1000', '1900', '100', '0', '0'), // perda 100/2000 = 5%
    ])));
    expect(alta.alertas.some(s => s.includes('perda'))).toBe(true);
  });
});
