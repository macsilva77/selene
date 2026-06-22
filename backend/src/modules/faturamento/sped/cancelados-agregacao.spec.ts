import { agregarCancelados, type FaturadoAno } from './cancelados-agregacao';
import type { DocCancelado } from './efd-icms-cancelados.parser';

const doc = (p: Partial<DocCancelado> = {}): DocCancelado => ({
  competencia: '2024-01', tipo: 'NFe', indOper: '1', modelo: '55', serie: '1',
  numDoc: '1', chave: '', dtDoc: '15012024', codPart: '', vlDoc: 1000,
  codSit: '02', extemporaneo: false, ...p,
});

describe('agregarCancelados', () => {
  it('soma resumo, separa extemporâneos, saídas, entradas e tipo', () => {
    const r = agregarCancelados([
      doc({ vlDoc: 1000, indOper: '1', tipo: 'NFe' }),
      doc({ vlDoc: 2000, indOper: '0', tipo: 'NFe' }),          // entrada
      doc({ vlDoc: 3000, indOper: '1', tipo: 'SAT', codSit: '03', extemporaneo: true }),
    ]);
    expect(r.resumo.qtd).toBe(3);
    expect(r.resumo.valor).toBeCloseTo(6000, 2);
    expect(r.resumo.qtdSaidas).toBe(2);
    expect(r.resumo.qtdEntradas).toBe(1);
    expect(r.resumo.valorSaidas).toBeCloseTo(4000, 2);
    expect(r.resumo.qtdExtemporaneos).toBe(1);
    expect(r.resumo.valorExtemporaneo).toBeCloseTo(3000, 2);
    expect(r.resumo.qtdNFe).toBe(2);
    expect(r.resumo.qtdSAT).toBe(1);
    expect(r.resumo.valorMedio).toBeCloseTo(2000, 2);
  });

  it('agrupa por ano e calcula taxas vs faturado', () => {
    const fat = new Map<number, FaturadoAno>([[2024, { valor: 40_000, qtd: 90 }]]);
    const r = agregarCancelados([
      doc({ competencia: '2024-01', vlDoc: 4000, indOper: '1' }),
      doc({ competencia: '2024-05', vlDoc: 6000, indOper: '1' }),
    ], fat);
    const a = r.porAno.find(x => x.ano === 2024)!;
    expect(a.valorSaidas).toBeCloseTo(10_000, 2);
    expect(a.valorFaturado).toBe(40_000);
    expect(a.taxaValor!).toBeCloseTo(10_000 / 40_000, 6);   // 0.25
    expect(a.taxaQtd!).toBeCloseTo(2 / (90 + 2), 6);
  });

  it('taxa null quando não há faturado do ano', () => {
    const r = agregarCancelados([doc({ competencia: '2023-01' })]);
    expect(r.porAno[0].taxaValor).toBeNull();
    expect(r.porAno[0].valorFaturado).toBeNull();
  });

  it('série mensal ordenada por competência', () => {
    const r = agregarCancelados([
      doc({ competencia: '2024-05' }),
      doc({ competencia: '2024-01' }),
      doc({ competencia: '2024-01' }),
    ]);
    expect(r.serieMensal.map(m => m.competencia)).toEqual(['2024-01', '2024-05']);
    expect(r.serieMensal[0].qtd).toBe(2);
  });

  it('lista vazia → resumo zerado', () => {
    const r = agregarCancelados([]);
    expect(r.resumo.qtd).toBe(0);
    expect(r.resumo.valorMedio).toBe(0);
    expect(r.porAno).toHaveLength(0);
    expect(r.serieMensal).toHaveLength(0);
  });
});
