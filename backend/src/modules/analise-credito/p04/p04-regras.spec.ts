/**
 * Testes unitários de p04-regras.ts
 *
 * Estratégia: RegraCtx e ConfigMap são montados com dados controlados.
 * Cada regra é testada para: disparo (deve gerar alerta), não-disparo, e casos-borda.
 *
 * Regressões explicitamente testadas (bugs corrigidos):
 *  - CR-08: não dispara quando PL ≤ 0 (evita "CT/CP 12.4x" com PL negativo)
 *  - PO-08: não dispara quando PL ≤ 0 (evita falso positivo de crescimento com dois negativos)
 */

import { Decimal } from '@prisma/client/runtime/library';
import { avaliarRegras, RegraCtx, ConfigMap, RegraCfg, AlertaRow } from './p04-regras';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function d(n: number): Decimal { return new Decimal(n); }

function makeCtx(
  inds: Record<string, number | null>,
  indsAnt: Record<string, number | null> = {},
  serie: Record<string, (number | null)[]> = {},
): RegraCtx {
  return {
    ind:    nome => inds[nome] != null ? d(inds[nome]!) : null,
    indAnt: nome => indsAnt[nome] != null ? d(indsAnt[nome]!) : null,
    serie:  nome => (serie[nome] ?? []).map(v => v != null ? d(v) : null),
    fonte:  _nome => 1,
  };
}

function makeMap(rules: Record<string, Partial<RegraCfg>>): ConfigMap {
  const m = new Map<string, RegraCfg>();
  for (const [code, cfg] of Object.entries(rules)) {
    m.set(code, {
      threshold1: cfg.threshold1 ?? null,
      threshold2: cfg.threshold2 ?? null,
      severidade: cfg.severidade ?? 'critico',
      templateMensagem: cfg.templateMensagem ?? '{val}',
      ativo: cfg.ativo ?? true,
    });
  }
  return m;
}

function getAlerta(alertas: AlertaRow[], codigo: string): AlertaRow | undefined {
  return alertas.find(a => a.codigoRegra === codigo);
}

// ConfigMap mínima: só as regras que o teste precisa
const MAP_CR08 = makeMap({ 'CR-08': { threshold1: 3, severidade: 'critico', templateMensagem: 'CT/CP de {val}x com tendência crescente — risco estrutural' } });
const MAP_PO08 = makeMap({ 'PO-08': { threshold1: 0.15, severidade: 'positivo', templateMensagem: 'Patrimônio Líquido cresceu {val}' } });
const MAP_CR09 = makeMap({ 'CR-09': { threshold1: 1.0, severidade: 'critico', templateMensagem: 'Imobilização do PL de {val}x' } });
const MAP_AT10 = makeMap({ 'AT-10': { severidade: 'atencao', templateMensagem: 'Saldo de tesouraria negativo' } });
const MAP_AT11 = makeMap({ 'AT-11': { threshold1: 0.05, severidade: 'atencao', templateMensagem: 'Margem bruta caiu {val} (atual: {mb})' } });
const MAP_AT12 = makeMap({ 'AT-12': { threshold1: 90, severidade: 'atencao', templateMensagem: 'Prazo de tributos de {val} dias' } });
const MAP_PO09 = makeMap({ 'PO-09': { severidade: 'positivo', templateMensagem: 'Saldo de tesouraria positivo' } });
const MAP_PO10 = makeMap({ 'PO-10': { threshold1: 0.30, severidade: 'positivo', templateMensagem: 'Margem bruta de {val}' } });

// ─── CR-08 (regressão: não dispara com PL negativo) ─────────────────────────

describe('CR-08 — CT/CP elevado e crescente', () => {
  it('dispara quando CT/CP > 3x e crescente, com PL positivo', () => {
    const ctx = makeCtx({ relacao_ct_cp: 12.4, pl: 65_000 }, { relacao_ct_cp: 8.0 });
    const alertas = avaliarRegras(ctx, MAP_CR08);
    expect(getAlerta(alertas, 'CR-08')).toBeDefined();
  });

  it('não dispara quando CT/CP < 3x', () => {
    const ctx = makeCtx({ relacao_ct_cp: 2.5, pl: 65_000 }, { relacao_ct_cp: 2.0 });
    expect(getAlerta(avaliarRegras(ctx, MAP_CR08), 'CR-08')).toBeUndefined();
  });

  it('não dispara quando CT/CP > 3x mas sem tendência crescente', () => {
    const ctx = makeCtx({ relacao_ct_cp: 5.0, pl: 65_000 }, { relacao_ct_cp: 6.0 });
    expect(getAlerta(avaliarRegras(ctx, MAP_CR08), 'CR-08')).toBeUndefined();
  });

  // REGRESSÃO: PL negativo → CT/CP = passivo/PL negativo, não deve disparar
  it('REGRESSÃO — não dispara quando PL é negativo (CT/CP matematicamente negativo)', () => {
    const ctx = makeCtx({ relacao_ct_cp: -12.4, pl: -64_900 }, { relacao_ct_cp: 14.4 });
    expect(getAlerta(avaliarRegras(ctx, MAP_CR08), 'CR-08')).toBeUndefined();
  });

  it('não dispara quando relacao_ct_cp é null', () => {
    const ctx = makeCtx({ relacao_ct_cp: null, pl: 65_000 }, { relacao_ct_cp: 8.0 });
    expect(getAlerta(avaliarRegras(ctx, MAP_CR08), 'CR-08')).toBeUndefined();
  });
});

// ─── PO-08 (regressão: não dispara com PL negativo) ─────────────────────────

describe('PO-08 — Crescimento do PL', () => {
  it('dispara quando crescimento_pl > 15% e PL positivo', () => {
    const ctx = makeCtx({ crescimento_pl: 0.20, pl: 64_900 });
    expect(getAlerta(avaliarRegras(ctx, MAP_PO08), 'PO-08')).toBeDefined();
  });

  it('não dispara quando crescimento_pl < 15%', () => {
    const ctx = makeCtx({ crescimento_pl: 0.10, pl: 64_900 });
    expect(getAlerta(avaliarRegras(ctx, MAP_PO08), 'PO-08')).toBeUndefined();
  });

  // REGRESSÃO PRINCIPAL: PL negativo + crescimento_pl positivo (artefato matemático)
  // Antes do fix, crescimento_pl = (-9K)/(-55.9K) = +16.1% → disparava como positivo
  it('REGRESSÃO — não dispara quando PL é negativo mesmo com crescimento_pl positivo', () => {
    const ctx = makeCtx({ crescimento_pl: 0.161, pl: -64_900 });
    expect(getAlerta(avaliarRegras(ctx, MAP_PO08), 'PO-08')).toBeUndefined();
  });

  it('não dispara quando PL é zero', () => {
    const ctx = makeCtx({ crescimento_pl: 0.20, pl: 0 });
    expect(getAlerta(avaliarRegras(ctx, MAP_PO08), 'PO-08')).toBeUndefined();
  });

  it('não dispara quando crescimento_pl é null', () => {
    const ctx = makeCtx({ crescimento_pl: null, pl: 65_000 });
    expect(getAlerta(avaliarRegras(ctx, MAP_PO08), 'PO-08')).toBeUndefined();
  });
});

// ─── CR-09 — Imobilização do PL ──────────────────────────────────────────────

describe('CR-09 — Imobilização do PL elevada', () => {
  it('dispara quando imobilizacao_pl > 1.0', () => {
    const ctx = makeCtx({ imobilizacao_pl: 1.5 });
    expect(getAlerta(avaliarRegras(ctx, MAP_CR09), 'CR-09')).toBeDefined();
  });

  it('não dispara quando imobilizacao_pl = 1.0 (exato no threshold)', () => {
    const ctx = makeCtx({ imobilizacao_pl: 1.0 });
    expect(getAlerta(avaliarRegras(ctx, MAP_CR09), 'CR-09')).toBeUndefined();
  });

  it('não dispara quando imobilizacao_pl < 1.0', () => {
    const ctx = makeCtx({ imobilizacao_pl: 0.7 });
    expect(getAlerta(avaliarRegras(ctx, MAP_CR09), 'CR-09')).toBeUndefined();
  });

  it('não dispara quando imobilizacao_pl é null (PL ≤ 0 no P03)', () => {
    const ctx = makeCtx({ imobilizacao_pl: null });
    expect(getAlerta(avaliarRegras(ctx, MAP_CR09), 'CR-09')).toBeUndefined();
  });

  it('a mensagem contém o valor formatado', () => {
    const ctx = makeCtx({ imobilizacao_pl: 1.8 });
    const alerta = getAlerta(avaliarRegras(ctx, MAP_CR09), 'CR-09');
    expect(alerta?.mensagem).toContain('1.80x');
  });
});

// ─── AT-10 — Tesouraria Negativa ─────────────────────────────────────────────

describe('AT-10 — Saldo de tesouraria negativo', () => {
  it('dispara quando saldo_tesouraria < 0', () => {
    const ctx = makeCtx({ saldo_tesouraria: -50_000 });
    expect(getAlerta(avaliarRegras(ctx, MAP_AT10), 'AT-10')).toBeDefined();
  });

  it('não dispara quando saldo_tesouraria > 0', () => {
    const ctx = makeCtx({ saldo_tesouraria: 10_000 });
    expect(getAlerta(avaliarRegras(ctx, MAP_AT10), 'AT-10')).toBeUndefined();
  });

  it('não dispara quando saldo_tesouraria = 0', () => {
    const ctx = makeCtx({ saldo_tesouraria: 0 });
    expect(getAlerta(avaliarRegras(ctx, MAP_AT10), 'AT-10')).toBeUndefined();
  });

  it('não dispara quando saldo_tesouraria é null', () => {
    const ctx = makeCtx({ saldo_tesouraria: null });
    expect(getAlerta(avaliarRegras(ctx, MAP_AT10), 'AT-10')).toBeUndefined();
  });
});

// ─── AT-11 — Queda de Margem Bruta ───────────────────────────────────────────

describe('AT-11 — Queda de margem bruta', () => {
  it('dispara quando margem_bruta caiu > 5pp vs exercício anterior', () => {
    // 42% → 35%: queda de 7pp > 5pp
    const ctx = makeCtx({ margem_bruta: 0.35 }, { margem_bruta: 0.42 });
    expect(getAlerta(avaliarRegras(ctx, MAP_AT11), 'AT-11')).toBeDefined();
  });

  it('não dispara quando queda é menor que 5pp', () => {
    // 40% → 38%: queda de 2pp < 5pp
    const ctx = makeCtx({ margem_bruta: 0.38 }, { margem_bruta: 0.40 });
    expect(getAlerta(avaliarRegras(ctx, MAP_AT11), 'AT-11')).toBeUndefined();
  });

  it('não dispara quando margem_bruta melhorou', () => {
    const ctx = makeCtx({ margem_bruta: 0.45 }, { margem_bruta: 0.38 });
    expect(getAlerta(avaliarRegras(ctx, MAP_AT11), 'AT-11')).toBeUndefined();
  });

  it('não dispara sem exercício anterior (indAnt null)', () => {
    const ctx = makeCtx({ margem_bruta: 0.30 });
    expect(getAlerta(avaliarRegras(ctx, MAP_AT11), 'AT-11')).toBeUndefined();
  });

  it('a mensagem contém a queda e o valor atual', () => {
    const ctx = makeCtx({ margem_bruta: 0.35 }, { margem_bruta: 0.42 });
    const alerta = getAlerta(avaliarRegras(ctx, MAP_AT11), 'AT-11');
    expect(alerta?.mensagem).toContain('7.0%');   // queda de 7pp
    expect(alerta?.mensagem).toContain('35.0%');  // atual
  });
});

// ─── AT-12 — Prazo de Tributos Elevado ───────────────────────────────────────

describe('AT-12 — Prazo médio de tributos elevado', () => {
  it('dispara quando pm_tributos > 90 dias', () => {
    const ctx = makeCtx({ pm_tributos: 120 });
    expect(getAlerta(avaliarRegras(ctx, MAP_AT12), 'AT-12')).toBeDefined();
  });

  it('não dispara quando pm_tributos = 90 dias (exato no threshold)', () => {
    const ctx = makeCtx({ pm_tributos: 90 });
    expect(getAlerta(avaliarRegras(ctx, MAP_AT12), 'AT-12')).toBeUndefined();
  });

  it('não dispara quando pm_tributos < 90 dias', () => {
    const ctx = makeCtx({ pm_tributos: 30 });
    expect(getAlerta(avaliarRegras(ctx, MAP_AT12), 'AT-12')).toBeUndefined();
  });

  it('não dispara quando pm_tributos é null', () => {
    const ctx = makeCtx({ pm_tributos: null });
    expect(getAlerta(avaliarRegras(ctx, MAP_AT12), 'AT-12')).toBeUndefined();
  });
});

// ─── PO-09 — Tesouraria Positiva ─────────────────────────────────────────────

describe('PO-09 — Saldo de tesouraria positivo', () => {
  it('dispara quando saldo_tesouraria > 0', () => {
    const ctx = makeCtx({ saldo_tesouraria: 50_000 });
    expect(getAlerta(avaliarRegras(ctx, MAP_PO09), 'PO-09')).toBeDefined();
  });

  it('não dispara quando saldo_tesouraria < 0', () => {
    const ctx = makeCtx({ saldo_tesouraria: -10_000 });
    expect(getAlerta(avaliarRegras(ctx, MAP_PO09), 'PO-09')).toBeUndefined();
  });

  it('não dispara quando saldo_tesouraria = 0', () => {
    const ctx = makeCtx({ saldo_tesouraria: 0 });
    expect(getAlerta(avaliarRegras(ctx, MAP_PO09), 'PO-09')).toBeUndefined();
  });

  it('não dispara quando saldo_tesouraria é null', () => {
    const ctx = makeCtx({ saldo_tesouraria: null });
    expect(getAlerta(avaliarRegras(ctx, MAP_PO09), 'PO-09')).toBeUndefined();
  });
});

// ─── PO-10 — Margem Bruta Saudável ───────────────────────────────────────────

describe('PO-10 — Margem bruta saudável', () => {
  it('dispara quando margem_bruta > 30%', () => {
    const ctx = makeCtx({ margem_bruta: 0.35 });
    expect(getAlerta(avaliarRegras(ctx, MAP_PO10), 'PO-10')).toBeDefined();
  });

  it('não dispara quando margem_bruta = 30% (exato no threshold)', () => {
    const ctx = makeCtx({ margem_bruta: 0.30 });
    expect(getAlerta(avaliarRegras(ctx, MAP_PO10), 'PO-10')).toBeUndefined();
  });

  it('não dispara quando margem_bruta < 30%', () => {
    const ctx = makeCtx({ margem_bruta: 0.25 });
    expect(getAlerta(avaliarRegras(ctx, MAP_PO10), 'PO-10')).toBeUndefined();
  });

  it('não dispara quando margem_bruta é null', () => {
    const ctx = makeCtx({ margem_bruta: null });
    expect(getAlerta(avaliarRegras(ctx, MAP_PO10), 'PO-10')).toBeUndefined();
  });
});

// ─── avaliarRegras: integração com mapa completo ─────────────────────────────

describe('avaliarRegras — integração', () => {
  it('inclui CR-09, AT-10, PO-09 simultaneamente quando condições satisfeitas', () => {
    const mapCompleto = makeMap({
      'CR-09': { threshold1: 1.0, severidade: 'critico', templateMensagem: 'Imob {val}x' },
      'AT-10': { severidade: 'atencao', templateMensagem: 'Tesouraria negativa' },
      'PO-09': { severidade: 'positivo', templateMensagem: 'Tesouraria positiva' },
    });

    // CR-09 dispara; AT-10 não dispara; PO-09 dispara
    const ctx = makeCtx({ imobilizacao_pl: 1.5, saldo_tesouraria: 20_000 });
    const alertas = avaliarRegras(ctx, mapCompleto);

    expect(getAlerta(alertas, 'CR-09')).toBeDefined();
    expect(getAlerta(alertas, 'AT-10')).toBeUndefined();
    expect(getAlerta(alertas, 'PO-09')).toBeDefined();
  });

  it('regra inativa (ativo=false) nunca dispara', () => {
    const mapInativo = new Map<string, RegraCfg>([
      ['CR-09', { threshold1: 1.0, threshold2: null, severidade: 'critico',
                  templateMensagem: 'Imob {val}x', ativo: false }],
    ]);
    const ctx = makeCtx({ imobilizacao_pl: 2.5 });
    expect(getAlerta(avaliarRegras(ctx, mapInativo), 'CR-09')).toBeUndefined();
  });

  it('retorna array vazio quando nenhuma regra está no mapa', () => {
    const ctx = makeCtx({ liquidez_corrente: 0.5, pl: -100 });
    expect(avaliarRegras(ctx, new Map())).toHaveLength(0);
  });
});
