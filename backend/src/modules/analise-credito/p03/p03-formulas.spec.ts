/**
 * Testes unitários de p03-formulas.ts
 *
 * As funções são puras (sem efeitos colaterais), portanto nenhum mock é necessário.
 * Cada suite cobre: caso normal, denominador zero → null, e casos-borda relevantes.
 *
 * Regressões explicitamente testadas:
 *  - crescimento_pl com PL negativo (bug: divisão de dois negativos gerava falso positivo)
 *  - ROIC com PL negativo (bug: capital investido ≈ 0 gerava 7912%)
 *  - imobilizacao_pl null quando PL ≤ 0
 */

import { Decimal } from '@prisma/client/runtime/library';
import {
  getBal, safeDiv,
  calcularIndicadores, calcularEstruturaCapital,
  BalData, DreData,
} from './p03-formulas';

// ─── Helpers de construção ────────────────────────────────────────────────────

function makeBal(entries: Record<string, Record<string, number>>): BalData {
  const m = new Map<string, Map<string, Decimal>>();
  for (const [grupo, subs] of Object.entries(entries)) {
    const inner = new Map<string, Decimal>();
    for (const [sub, val] of Object.entries(subs)) inner.set(sub, new Decimal(val));
    m.set(grupo, inner);
  }
  return m;
}

function makeDre(entries: Record<string, number>): DreData {
  const m = new Map<string, Decimal>();
  for (const [k, v] of Object.entries(entries)) m.set(k, new Decimal(v));
  return m;
}

function find(result: ReturnType<typeof calcularIndicadores>, name: string) {
  return result.find(i => i.indicador === name);
}

function val(result: ReturnType<typeof calcularIndicadores>, name: string): number | null {
  const found = find(result, name);
  return found?.valor != null ? Number(found.valor) : null;
}

// Balanço e DRE base para os testes (empresa saudável hipotética)
const BAL_BASE = makeBal({
  AC:  { 'Caixa e Equivalentes': 100_000, 'Contas a Receber': 200_000, 'Estoques': 150_000, 'Outros AC': 50_000 },
  ANC: { 'Imobilizado': 300_000, 'Intangível': 50_000, 'RLP': 30_000 },
  PC:  { 'Fornecedores': 80_000, 'Empréstimos CP': 40_000, 'Tributos a Pagar': 30_000, 'Salários e Encargos': 20_000 },
  PNC: { 'Empréstimos LP': 150_000 },
  PL:  { 'Capital Social': 200_000, 'Lucros Acumulados': 360_000 },
});

const DRE_BASE = makeDre({
  receita_bruta:   1_500_000,
  receita_liquida: 1_200_000,
  lucro_bruto:       480_000,   // margem bruta = 40%
  cmv:               720_000,
  desp_vendas:        60_000,
  desp_admin:        100_000,
  desp_financeiras:   18_000,
  ebit:              300_000,
  ebitda:            360_000,   // margem ebitda = 30%
  lucro_liquido:     200_000,
});

// ─── getBal ───────────────────────────────────────────────────────────────────

describe('getBal', () => {
  it('retorna 0 para grupo ausente', () => {
    expect(getBal(makeBal({}), 'AC', '*').toNumber()).toBe(0);
  });

  it('soma todos os subgrupos com *', () => {
    const bal = makeBal({ AC: { Caixa: 100, Clientes: 200 } });
    expect(getBal(bal, 'AC', '*').toNumber()).toBe(300);
  });

  it('retorna subgrupo específico', () => {
    const bal = makeBal({ AC: { Caixa: 75, Clientes: 200 } });
    expect(getBal(bal, 'AC', 'Caixa').toNumber()).toBe(75);
  });

  it('retorna 0 para subgrupo ausente', () => {
    const bal = makeBal({ AC: { Caixa: 100 } });
    expect(getBal(bal, 'AC', 'Inexistente').toNumber()).toBe(0);
  });
});

// ─── safeDiv ─────────────────────────────────────────────────────────────────

describe('safeDiv', () => {
  it('retorna null para denominador zero', () => {
    expect(safeDiv(new Decimal(100), new Decimal(0))).toBeNull();
  });

  it('retorna null para null no numerador', () => {
    expect(safeDiv(null, new Decimal(5))).toBeNull();
  });

  it('retorna null para null no denominador', () => {
    expect(safeDiv(new Decimal(10), null)).toBeNull();
  });

  it('calcula corretamente', () => {
    const r = safeDiv(new Decimal(10), new Decimal(4));
    expect(r?.toNumber()).toBe(2.5);
  });

  it('aceita numerador negativo', () => {
    const r = safeDiv(new Decimal(-10), new Decimal(4));
    expect(r?.toNumber()).toBe(-2.5);
  });
});

// ─── Grupo 1 — Liquidez ───────────────────────────────────────────────────────

describe('calcularIndicadores — Grupo 1: Liquidez', () => {
  const res = calcularIndicadores(BAL_BASE, DRE_BASE);

  // AC=500K, PC=170K → LC=2.94x
  it('liquidez_corrente = AC / PC', () => {
    expect(val(res, 'liquidez_corrente')).toBeCloseTo(500_000 / 170_000, 4);
  });

  // (AC - Estoques) / PC = (500K-150K)/170K = 2.06x
  it('liquidez_seca = (AC - Estoques) / PC', () => {
    expect(val(res, 'liquidez_seca')).toBeCloseTo(350_000 / 170_000, 4);
  });

  it('liquidez_corrente null quando PC=0', () => {
    const bal = makeBal({ AC: { Caixa: 100 }, PC: {}, PNC: {}, ANC: {}, PL: { Capital: 100 } });
    const r = calcularIndicadores(bal, DRE_BASE);
    expect(val(r, 'liquidez_corrente')).toBeNull();
  });
});

// ─── Grupo 2 — Rentabilidade (existente) ─────────────────────────────────────

describe('calcularIndicadores — Grupo 2: Rentabilidade existente', () => {
  const res = calcularIndicadores(BAL_BASE, DRE_BASE);

  it('margem_ebitda = EBITDA / Receita Líquida', () => {
    expect(val(res, 'margem_ebitda')).toBeCloseTo(360_000 / 1_200_000, 6);
  });

  it('roe = Lucro Líquido / PL', () => {
    // PL = 200K + 360K = 560K; LL = 200K → ROE = 35.7%
    expect(val(res, 'roe')).toBeCloseTo(200_000 / 560_000, 4);
  });

  // REGRESSÃO: ROIC deve ser null quando PL < 0
  it('ROIC é null quando PL é negativo', () => {
    const bal = makeBal({
      AC:  { 'Caixa e Equivalentes': 100_000 },
      ANC: {},
      PC:  { 'Empréstimos CP': 0 },
      PNC: { 'Empréstimos LP': 70_900 },
      PL:  { 'Resultado do Exercício': -64_900 },
    });
    const r = calcularIndicadores(bal, DRE_BASE);
    expect(val(r, 'roic')).toBeNull();
  });

  // REGRESSÃO: ROIC com capital investido negativo → null
  it('ROIC é null quando capital investido (PL+DF) é negativo', () => {
    const bal = makeBal({
      AC:  { 'Caixa e Equivalentes': 100_000 },
      ANC: {},
      PC:  { 'Empréstimos CP': 10_000 },
      PNC: { 'Empréstimos LP': 0 },
      PL:  { 'Capital': -50_000 },
    });
    const r = calcularIndicadores(bal, DRE_BASE);
    expect(val(r, 'roic')).toBeNull();
  });

  it('ROIC calcula corretamente quando PL e capital investido são positivos', () => {
    // PL=560K, EmpCP=40K, EmpLP=150K → capitalInvestido=750K; EBIT=300K → ROIC=40%
    const res2 = calcularIndicadores(BAL_BASE, DRE_BASE);
    expect(val(res2, 'roic')).toBeCloseTo(300_000 / 750_000, 4);
  });
});

// ─── Grupo 2 — Novas margens ─────────────────────────────────────────────────

describe('calcularIndicadores — Grupo 2: Novas margens', () => {
  const res = calcularIndicadores(BAL_BASE, DRE_BASE);

  it('margem_bruta = lucro_bruto / receita_liquida (40%)', () => {
    expect(val(res, 'margem_bruta')).toBeCloseTo(480_000 / 1_200_000, 6);
  });

  it('margem_ebit = ebit / receita_liquida (25%)', () => {
    expect(val(res, 'margem_ebit')).toBeCloseTo(300_000 / 1_200_000, 6);
  });

  it('cobertura_ebitda_df = ebitda / desp_financeiras', () => {
    expect(val(res, 'cobertura_ebitda_df')).toBeCloseTo(360_000 / 18_000, 4);
  });

  it('margem_bruta null quando receita_liquida=0', () => {
    const dre = makeDre({ receita_liquida: 0, lucro_bruto: 0, ebitda: 0, ebit: 0, lucro_liquido: 0 });
    const r = calcularIndicadores(BAL_BASE, dre);
    expect(val(r, 'margem_bruta')).toBeNull();
  });

  it('cobertura_ebitda_df null quando desp_financeiras=0', () => {
    const dre = makeDre({ ...Object.fromEntries(DRE_BASE), desp_financeiras: 0 });
    const r = calcularIndicadores(BAL_BASE, dre);
    expect(val(r, 'cobertura_ebitda_df')).toBeNull();
  });
});

// ─── Grupo 3 — Ativo operacional absoluto ────────────────────────────────────

describe('calcularIndicadores — Grupo 3: ativo_clientes e ativo_estoques', () => {
  const res = calcularIndicadores(BAL_BASE, DRE_BASE);

  it('ativo_clientes = Contas a Receber do BalData', () => {
    expect(val(res, 'ativo_clientes')).toBe(200_000);
  });

  it('ativo_estoques = Estoques do BalData', () => {
    expect(val(res, 'ativo_estoques')).toBe(150_000);
  });
});

// ─── Grupo 7 — Fleuriet ──────────────────────────────────────────────────────

describe('calcularIndicadores — Grupo 7: Modelo Fleuriet', () => {
  const res = calcularIndicadores(BAL_BASE, DRE_BASE);

  // Balanço base:
  // CDG = AC(500K) - PC(170K) = 330K
  // NCG = Clientes(200K) + Estoques(150K) - Fornecedores(80K) - Tributos(30K) - Salários(20K) = 220K
  // T = CDG(330K) - NCG(220K) = 110K
  it('capital_giro = AC - PC', () => {
    expect(val(res, 'capital_giro')).toBeCloseTo(500_000 - 170_000, 0);
  });

  it('ncg = Clientes + Estoques - Fornecedores - Tributos - Salários', () => {
    const expected = 200_000 + 150_000 - 80_000 - 30_000 - 20_000;
    expect(val(res, 'ncg')).toBeCloseTo(expected, 0);
  });

  it('saldo_tesouraria = capital_giro - ncg', () => {
    const cdg = 500_000 - 170_000;
    const ncg = 200_000 + 150_000 - 80_000 - 30_000 - 20_000;
    expect(val(res, 'saldo_tesouraria')).toBeCloseTo(cdg - ncg, 0);
  });

  it('saldo_tesouraria negativo quando PC é alto', () => {
    const bal = makeBal({
      AC:  { 'Caixa e Equivalentes': 10_000, 'Contas a Receber': 200_000, 'Estoques': 300_000 },
      ANC: {},
      PC:  { 'Fornecedores': 50_000, 'Empréstimos CP': 400_000, 'Tributos a Pagar': 50_000, 'Salários e Encargos': 20_000 },
      PNC: {},
      PL:  { 'Capital': 0 },
    });
    const r = calcularIndicadores(bal, DRE_BASE);
    // CDG = 510K - 520K = -10K; NCG = 200K+300K-50K-50K-20K = 380K; T = -390K
    expect(val(r, 'saldo_tesouraria')).toBeLessThan(0);
  });

  it('ativo_imobilizado = Imobilizado + Intangível', () => {
    expect(val(res, 'ativo_imobilizado')).toBe(350_000);
  });
});

// ─── Grupo 8 — Imobilização ──────────────────────────────────────────────────

describe('calcularIndicadores — Grupo 8: Imobilização', () => {
  const res = calcularIndicadores(BAL_BASE, DRE_BASE);

  // ativoFixo=350K, PL=560K → imobPL=0.625x
  it('imobilizacao_pl = ativoFixo / PL quando PL > 0', () => {
    expect(val(res, 'imobilizacao_pl')).toBeCloseTo(350_000 / 560_000, 4);
  });

  // PL=560K, PNC=150K → plPnc=710K; imobRecPerm=350K/710K=0.493x
  it('imobilizacao_rec_perm = ativoFixo / (PL + PNC)', () => {
    expect(val(res, 'imobilizacao_rec_perm')).toBeCloseTo(350_000 / 710_000, 4);
  });

  // ativoFixo=350K, ativoTot=880K → 39.8%
  it('imob_ativo_pct = ativoFixo / ativoTotal', () => {
    expect(val(res, 'imob_ativo_pct')).toBeCloseTo(350_000 / 880_000, 4);
  });

  // Tributos=30K, recBruta=1500K → pm_tributos = 30K*360/1500K = 7.2 dias
  it('pm_tributos = (Tributos * 360) / receita_bruta', () => {
    expect(val(res, 'pm_tributos')).toBeCloseTo((30_000 * 360) / 1_500_000, 4);
  });

  it('imobilizacao_pl é null quando PL é negativo', () => {
    const bal = makeBal({
      AC: {}, ANC: { 'Imobilizado': 100_000 }, PC: {}, PNC: {},
      PL: { 'Resultado': -50_000 },
    });
    const r = calcularIndicadores(bal, DRE_BASE);
    expect(val(r, 'imobilizacao_pl')).toBeNull();
  });

  it('imobilizacao_pl é null quando PL é zero', () => {
    const bal = makeBal({
      AC: {}, ANC: { 'Imobilizado': 100_000 }, PC: {}, PNC: {},
      PL: { 'Capital': 0 },
    });
    const r = calcularIndicadores(bal, DRE_BASE);
    expect(val(r, 'imobilizacao_pl')).toBeNull();
  });

  it('imobilizacao_rec_perm é null quando PL + PNC é negativo', () => {
    const bal = makeBal({
      AC: {}, ANC: { 'Imobilizado': 100_000 }, PC: {}, PNC: { 'Empréstimos LP': 20_000 },
      PL: { 'Resultado': -50_000 },
    });
    const r = calcularIndicadores(bal, DRE_BASE);
    expect(val(r, 'imobilizacao_rec_perm')).toBeNull();
  });

  it('pm_tributos null quando receita_bruta=0', () => {
    const dre = makeDre({ ...Object.fromEntries(DRE_BASE), receita_bruta: 0 });
    const r = calcularIndicadores(BAL_BASE, dre);
    expect(val(r, 'pm_tributos')).toBeNull();
  });
});

// ─── Grupo 6 — Crescimento: regressão crescimento_pl ─────────────────────────

describe('calcularIndicadores — Grupo 6: Crescimento (regressões)', () => {
  const makeHistorico = (plAtual: number, plAnt: number) => {
    const balAtual = makeBal({
      AC: { Caixa: 100 }, ANC: {}, PC: {}, PNC: {},
      PL: { Capital: plAtual },
    });
    const balAnterior = makeBal({
      AC: { Caixa: 100 }, ANC: {}, PC: {}, PNC: {},
      PL: { Capital: plAnt },
    });
    return calcularIndicadores(balAtual, DRE_BASE, balAnterior, DRE_BASE);
  };

  // REGRESSÃO PRINCIPAL: PL foi de -55.9K para -64.9K (piorou)
  // Fórmula corrigida usa abs(plAnt): (-64.9K - (-55.9K)) / abs(-55.9K) = -9K/55.9K = -16.1%
  // Fórmula antiga (bug): (-9K) / (-55.9K) = +16.1% → FALSO POSITIVO
  it('crescimento_pl é negativo quando PL ficou mais negativo', () => {
    const r = makeHistorico(-64_900, -55_900);
    const cpl = val(r, 'crescimento_pl');
    expect(cpl).not.toBeNull();
    expect(cpl!).toBeLessThan(0);
    expect(cpl!).toBeCloseTo((-64_900 - (-55_900)) / 55_900, 4);
  });

  // PL melhorou (de -55.9K para -20K): deveria ser positivo
  it('crescimento_pl é positivo quando PL negativo melhorou (ficou menos negativo)', () => {
    const r = makeHistorico(-20_000, -55_900);
    const cpl = val(r, 'crescimento_pl');
    expect(cpl).not.toBeNull();
    expect(cpl!).toBeGreaterThan(0);
    expect(cpl!).toBeCloseTo((-20_000 - (-55_900)) / 55_900, 4);
  });

  // Caso positivo normal (PL de 55.9K para 64.9K)
  it('crescimento_pl positivo e correto com PL positivo crescendo', () => {
    const r = makeHistorico(64_900, 55_900);
    const cpl = val(r, 'crescimento_pl');
    expect(cpl).not.toBeNull();
    expect(cpl!).toBeGreaterThan(0);
    expect(cpl!).toBeCloseTo((64_900 - 55_900) / 55_900, 4);
  });

  // PL anterior zero → null (sem divisão por zero)
  it('crescimento_pl é null quando PL anterior é zero', () => {
    const r = makeHistorico(100_000, 0);
    expect(val(r, 'crescimento_pl')).toBeNull();
  });

  // Sem histórico → null
  it('crescimento_pl é null sem exercício anterior', () => {
    const r = calcularIndicadores(BAL_BASE, DRE_BASE);
    expect(val(r, 'crescimento_pl')).toBeNull();
  });
});

// ─── calcularEstruturaCapital ─────────────────────────────────────────────────

describe('calcularEstruturaCapital', () => {
  it('ativoTotal = AC + ANC', () => {
    const ec = calcularEstruturaCapital(BAL_BASE, DRE_BASE);
    expect(ec.ativoTotal.toNumber()).toBe(500_000 + 380_000);
  });

  it('grauEndividamento = passivo / ativo', () => {
    const ec = calcularEstruturaCapital(BAL_BASE, DRE_BASE);
    // PC=170K, PNC=150K, passivo=320K; ativo=880K → 36.4%
    expect(ec.grauEndividamento?.toNumber()).toBeCloseTo(320_000 / 880_000, 4);
  });

  it('relacaoCtCp é null quando PL=0', () => {
    const bal = makeBal({ AC: { Caixa: 100 }, ANC: {}, PC: { Fornec: 100 }, PNC: {}, PL: { Capital: 0 } });
    const ec = calcularEstruturaCapital(bal, DRE_BASE);
    expect(ec.relacaoCtCp).toBeNull();
  });
});
