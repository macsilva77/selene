import { classificarCruzamento } from './cruzamento-receita';

describe('classificarCruzamento', () => {
  it('CONSISTENTE quando vendas EFD ≈ receita ECF (ano completo)', () => {
    expect(classificarCruzamento(1_000_000, 1_000_000, 12).flag).toBe('CONSISTENTE');
    expect(classificarCruzamento(1_000_000, 850_000, 12).flag).toBe('CONSISTENTE');
  });

  it('SUBDECLARACAO quando EFD vende >> ECF declara', () => {
    const r = classificarCruzamento(1_000_000, 1_800_000, 12);
    expect(r.flag).toBe('SUBDECLARACAO');
    expect(r.ratio).toBeCloseTo(1.8, 2);
  });

  it('SERVICO quando mercadoria EFD ≈ 0 mas ECF tem receita', () => {
    // 08248940: ECF 70M, EFD mercadoria 0
    expect(classificarCruzamento(70_000_000, 0, 12).flag).toBe('SERVICO');
    expect(classificarCruzamento(11_000_000, 100_000, 12).flag).toBe('SERVICO'); // <5%
  });

  it('DIVERGENCIA quando ECF declara >> vendas mercadoria EFD (com mercadoria material)', () => {
    expect(classificarCruzamento(1_000_000, 600_000, 12).flag).toBe('DIVERGENCIA');
  });

  it('SEM_DADOS quando EFD incompleto (< 10 meses) ou ECF ausente', () => {
    // EDROMA 2024: poucos meses de EFD → não comparar
    expect(classificarCruzamento(33_000_000, 770_000, 3).flag).toBe('SEM_DADOS');
    expect(classificarCruzamento(0, 500_000, 12).flag).toBe('SEM_DADOS');
  });
});
