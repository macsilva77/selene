/**
 * Agregação pura dos documentos cancelados em métricas de risco.
 * Sem I/O — testável isoladamente.
 */
import type { DocCancelado } from './efd-icms-cancelados.parser';

export interface FaturadoAno {
  valor: number; // faturamento bruto VÁLIDO (saídas) do ano
  qtd:   number; // qtd de documentos válidos de saída do ano
}

export interface CanceladosPorAno {
  ano:                number;
  qtd:                number;
  valor:              number;
  qtdExtemporaneos:   number;
  valorExtemporaneo:  number;
  qtdSaidas:          number;
  valorSaidas:        number;
  valorFaturado:      number | null; // bruto válido (saídas) do ano
  taxaValor:          number | null; // valorSaidas canceladas / faturado válido
  taxaQtd:            number | null; // qtdSaidas canceladas / (válidos + canceladas)
}

export interface CanceladosSerieMes {
  competencia: string; // AAAA-MM
  qtd:         number;
  valor:       number;
}

export interface CanceladosResumo {
  qtd:                number;
  valor:              number; // ⚠ no SPED, cancelado vem com valor em branco — tende a 0
  qtdExtemporaneos:   number;
  valorExtemporaneo:  number;
  qtdSaidas:          number;
  valorSaidas:        number;
  qtdEntradas:        number; // canceladas de entrada (fornecedor cancelou a compra)
  qtdNFe:             number; // modelos 55/65
  qtdSAT:             number; // CF-e SAT (modelo 59)
  valorMedio:         number; // valor / qtd
}

export interface CanceladosAgregado {
  resumo:      CanceladosResumo;
  porAno:      CanceladosPorAno[];
  serieMensal: CanceladosSerieMes[];
}

const anoDe = (competencia: string): number => Number.parseInt(competencia.slice(0, 4), 10) || 0;

function acumularAno(
  anoMap: Map<number, CanceladosPorAno>,
  ano: number,
  d: DocCancelado,
  saida: boolean,
): void {
  const a = anoMap.get(ano) ?? {
    ano, qtd: 0, valor: 0, qtdExtemporaneos: 0, valorExtemporaneo: 0,
    qtdSaidas: 0, valorSaidas: 0, valorFaturado: null, taxaValor: null, taxaQtd: null,
  };
  a.qtd += 1; a.valor += d.vlDoc;
  if (d.extemporaneo) { a.qtdExtemporaneos += 1; a.valorExtemporaneo += d.vlDoc; }
  if (saida) { a.qtdSaidas += 1; a.valorSaidas += d.vlDoc; }
  anoMap.set(ano, a);
}

export function agregarCancelados(
  docs: DocCancelado[],
  faturadoPorAno: Map<number, FaturadoAno> = new Map(),
): CanceladosAgregado {
  const resumo: CanceladosResumo = {
    qtd: 0, valor: 0, qtdExtemporaneos: 0, valorExtemporaneo: 0,
    qtdSaidas: 0, valorSaidas: 0, qtdEntradas: 0, qtdNFe: 0, qtdSAT: 0, valorMedio: 0,
  };

  const anoMap = new Map<number, CanceladosPorAno>();
  const mesMap = new Map<string, CanceladosSerieMes>();

  for (const d of docs) {
    const saida = d.indOper === '1';
    resumo.qtd   += 1;
    resumo.valor += d.vlDoc;
    if (d.extemporaneo) { resumo.qtdExtemporaneos += 1; resumo.valorExtemporaneo += d.vlDoc; }
    if (saida) { resumo.qtdSaidas += 1; resumo.valorSaidas += d.vlDoc; } else { resumo.qtdEntradas += 1; }
    if (d.tipo === 'SAT') { resumo.qtdSAT += 1; } else { resumo.qtdNFe += 1; }

    acumularAno(anoMap, anoDe(d.competencia), d, saida);

    if (d.competencia) {
      const m = mesMap.get(d.competencia) ?? { competencia: d.competencia, qtd: 0, valor: 0 };
      m.qtd += 1; m.valor += d.vlDoc;
      mesMap.set(d.competencia, m);
    }
  }

  resumo.valorMedio = resumo.qtd > 0 ? resumo.valor / resumo.qtd : 0;

  // taxas por ano (saídas canceladas vs faturado válido de saída)
  for (const [ano, a] of anoMap) {
    const fat = faturadoPorAno.get(ano);
    if (fat) {
      a.valorFaturado = fat.valor;
      a.taxaValor = fat.valor > 0 ? a.valorSaidas / fat.valor : null;
      const totalQtd = fat.qtd + a.qtdSaidas;
      a.taxaQtd = totalQtd > 0 ? a.qtdSaidas / totalQtd : null;
    }
  }

  return {
    resumo,
    porAno:      [...anoMap.values()].sort((x, y) => x.ano - y.ano),
    serieMensal: [...mesMap.values()].sort((x, y) => x.competencia.localeCompare(y.competencia)),
  };
}
