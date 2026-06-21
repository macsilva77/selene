import { agregarLtm, LtmRow } from './faturamento-query.service';

const row = (ano: number, mes: number, p: Partial<LtmRow> = {}): LtmRow => ({
  ano, mes, bruto: 0, icms: 0, ipi: 0, pis: 0, cofins: 0, dev: 0, transf: 0, rem: 0, ...p,
});

describe('agregarLtm', () => {
  it('soma bruto/impostos e calcula carga tributária + líquido + vendas mercadoria', () => {
    const r = agregarLtm([
      row(2026, 1, { bruto: 1000, icms: 50, ipi: 10, pis: 16, cofins: 74, dev: 20, transf: 100, rem: 30 }),
      row(2025, 12, { bruto: 2000, icms: 100, pis: 33, cofins: 152 }),
    ]);
    expect(r.vlFaturamentoBruto).toBeCloseTo(3000, 2);
    expect(r.vlImpostos).toBeCloseTo(50 + 10 + 16 + 74 + 100 + 33 + 152, 2); // 435
    expect(r.cargaTributaria!).toBeCloseTo(435 / 3000, 6);
    // vendas mercadoria = bruto − dev − transf − rem
    expect(r.vlVendasMercadoria).toBeCloseTo(3000 - 20 - 100 - 30, 2);
    // líquido = bruto − impostos − devoluções
    expect(r.vlFatLiquido).toBeCloseTo(3000 - 435 - 20, 2);
  });

  it('período vai do menor ao maior (AAAA-MM) e conta meses', () => {
    const r = agregarLtm([row(2026, 5), row(2025, 6), row(2026, 1)]);
    expect(r.meses).toBe(3);
    expect(r.periodoInicio).toBe('2025-06');
    expect(r.periodoFim).toBe('2026-05');
  });

  it('cargaTributaria é null quando bruto = 0', () => {
    const r = agregarLtm([row(2026, 1, { icms: 10 })]);
    expect(r.cargaTributaria).toBeNull();
    expect(r.vlFaturamentoBruto).toBe(0);
  });

  it('lista vazia → 0 meses e períodos null', () => {
    const r = agregarLtm([]);
    expect(r.meses).toBe(0);
    expect(r.periodoInicio).toBeNull();
    expect(r.periodoFim).toBeNull();
    expect(r.cargaTributaria).toBeNull();
  });

  it('não emite valores negativos em vendas/líquido', () => {
    const r = agregarLtm([row(2026, 1, { bruto: 100, dev: 200 })]);
    expect(r.vlVendasMercadoria).toBe(0);
    expect(r.vlFatLiquido).toBe(0);
  });
});
