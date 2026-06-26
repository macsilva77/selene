import {
  simularLucroPresumido,
  simularLucroReal,
  simularSimplesNacional,
  simularRegimes,
  type EntradaSimulacao,
} from './simulacao-tributaria';

const base = (over: Partial<EntradaSimulacao> = {}): EntradaSimulacao => ({
  receitaBruta: 1_000_000,
  lairContabil: null,
  margemProxy: null,
  atividade: 'comercio',
  regimeAtual: null,
  ...over,
});

describe('Lucro Presumido', () => {
  it('comércio: IRPJ/CSLL sobre presunção + PIS/COFINS cumulativo', () => {
    const r = simularLucroPresumido(base({ receitaBruta: 1_000_000, atividade: 'comercio' }));
    // base IRPJ = 80.000 → 15% = 12.000; sem adicional (base < 240k)
    const irpj = r.tributos.find(t => t.sigla === 'IRPJ')!;
    expect(irpj.valor).toBeCloseTo(12_000, 0);
    // base CSLL = 120.000 → 9% = 10.800
    expect(r.tributos.find(t => t.sigla === 'CSLL')!.valor).toBeCloseTo(10_800, 0);
    // PIS 0,65% = 6.500 ; COFINS 3% = 30.000
    expect(r.tributos.find(t => t.sigla === 'PIS')!.valor).toBeCloseTo(6_500, 0);
    expect(r.tributos.find(t => t.sigla === 'COFINS')!.valor).toBeCloseTo(30_000, 0);
    expect(r.totalFederal).toBeCloseTo(59_300, 0);
  });

  it('aplica adicional de 10% de IRPJ quando a base presumida excede 240k/ano', () => {
    // serviço, receita 1M → base IRPJ 320.000 → adicional sobre 80.000 = 8.000
    const r = simularLucroPresumido(base({ receitaBruta: 1_000_000, atividade: 'servico' }));
    const irpj = r.tributos.find(t => t.sigla === 'IRPJ')!;
    // 320k×15% = 48.000 + 8.000 = 56.000
    expect(irpj.valor).toBeCloseTo(56_000, 0);
  });
});

describe('Lucro Real', () => {
  it('usa o LAIR contábil quando informado', () => {
    const r = simularLucroReal(base({ receitaBruta: 1_000_000, lairContabil: 200_000 }));
    expect(r.estimado).toBe(false);
    // IRPJ 200k×15% = 30.000 (base < 240k, sem adicional); CSLL 200k×9% = 18.000
    expect(r.tributos.find(t => t.sigla === 'IRPJ')!.valor).toBeCloseTo(30_000, 0);
    expect(r.tributos.find(t => t.sigla === 'CSLL')!.valor).toBeCloseTo(18_000, 0);
    // PIS 1,65% = 16.500 ; COFINS 7,6% = 76.000
    expect(r.tributos.find(t => t.sigla === 'PIS')!.valor).toBeCloseTo(16_500, 0);
    expect(r.tributos.find(t => t.sigla === 'COFINS')!.valor).toBeCloseTo(76_000, 0);
  });

  it('marca estimado quando falta o LAIR e usa margem-proxy', () => {
    const r = simularLucroReal(base({ receitaBruta: 1_000_000, lairContabil: null, margemProxy: 0.2 }));
    expect(r.estimado).toBe(true);
    expect(r.tributos.find(t => t.sigla === 'IRPJ')!.valor).toBeCloseTo(30_000, 0);
  });
});

describe('Simples Nacional', () => {
  it('é inelegível acima do teto de 4,8 mi', () => {
    const r = simularSimplesNacional(base({ receitaBruta: 6_000_000 }));
    expect(r.elegivel).toBe(false);
    expect(r.totalFederal).toBeNull();
  });

  it('comércio faixa 3: alíquota efetiva e partilha do DAS', () => {
    // RBT12 = 500.000, Anexo I faixa 3 (aliq 9,5%, deduzir 13.860)
    const r = simularSimplesNacional(base({ receitaBruta: 500_000, atividade: 'comercio' }));
    expect(r.elegivel).toBe(true);
    // efetiva = (500.000×0,095 − 13.860)/500.000 = (47.500 − 13.860)/500.000 = 6,728%
    // DAS = 33.640
    expect(r.totalUnificado).toBeCloseTo(33_640, 0);
    // partilha soma 100% do DAS
    const somaPart = r.tributos.reduce((s, t) => s + (t.partilha ?? 0), 0);
    expect(somaPart).toBeCloseTo(1, 5);
    // total dos tributos = DAS
    const somaTrib = r.tributos.reduce((s, t) => s + t.valor, 0);
    expect(somaTrib).toBeCloseTo(33_640, 0);
    // federal < DAS (porque CPP+ICMS estão fora)
    expect(r.totalFederal!).toBeLessThan(r.totalUnificado!);
  });

  it('serviço usa Anexo III e rotula ISS', () => {
    const r = simularSimplesNacional(base({ receitaBruta: 300_000, atividade: 'servico' }));
    expect(r.tributos.some(t => t.sigla === 'ISS')).toBe(true);
  });
});

describe('Orquestrador', () => {
  it('recomenda o regime elegível de menor carga federal e calcula economia vs atual', () => {
    const r = simularRegimes(base({ receitaBruta: 1_000_000, atividade: 'comercio', regimeAtual: 'lucro_real', lairContabil: 300_000 }));
    expect(r.regimes).toHaveLength(3);
    expect(r.recomendado).not.toBeNull();
    // economia = federal(atual) − federal(recomendado) ≥ 0 quando o atual não é o melhor
    if (r.recomendado !== 'lucro_real') expect(r.economiaVsAtual!).toBeGreaterThanOrEqual(0);
  });

  it('acima do teto, Simples sai como inelegível e a recomendação vem de LP/LR', () => {
    const r = simularRegimes(base({ receitaBruta: 10_000_000, atividade: 'comercio', regimeAtual: 'lucro_presumido' }));
    expect(r.regimes.find(x => x.regime === 'simples_nacional')!.elegivel).toBe(false);
    expect(['lucro_presumido', 'lucro_real']).toContain(r.recomendado);
  });
});
