/**
 * Análise do estoque fiscal de COMBUSTÍVEL (sobre o Bloco 1300/1310).
 *
 * Diferente do estoque geral (Bloco H + C170), aqui a venda é MEDIDA (litro a litro) e há
 * perda/ganho explícitos. Indicadores por combustível:
 *   - venda, entradas, perda, ganho (litros)
 *   - perda% = perda ÷ (abertura + entradas)         → evaporação/quebra
 *   - quebra líquida = ganho − perda                 → sobra(+)/falta(−)
 *   - giro = venda ÷ estoque médio
 *   - cobertura (dias) = estoque final ÷ venda média/dia
 *   - consistência escritural: fechamento físico × escritural (abertura+entradas−vendas)
 */
import type { MovimentoCombustivel, CombustivelMovimento } from './efd-bloco1300-combustivel.parser';

// limite de perda típica (evaporação) — acima disso, alerta. ANP tolera ~0,6% gasolina/etanol.
const PERDA_ALERTA = 0.006;

export interface CombustivelAnalisado {
  codItem: string;
  descricao: string;
  ncm: string;
  estqAbertura: number;
  entradas: number;
  vendas: number;
  perda: number;
  ganho: number;
  estqFechamento: number;
  perdaPercent: number;       // perda ÷ (abertura + entradas)
  quebraLiquida: number;      // ganho − perda
  escrituralFechamento: number; // abertura + entradas − vendas − perda + ganho
  divergenciaFisicoEscritural: number; // físico − escritural
  giro: number;
  coberturaDias: number;
}

export interface AnaliseCombustivel {
  cnpj: string;
  dtIni: string;
  dtFin: string;
  temBloco1300: boolean;
  totalVendas: number;
  totalEntradas: number;
  totalPerda: number;
  totalGanho: number;
  perdaPercentGlobal: number;
  combustiveis: CombustivelAnalisado[]; // ordenado por venda desc
  alertas: string[];
}

export function analisarCombustivel(mov: MovimentoCombustivel): AnaliseCombustivel {
  const combustiveis = [...mov.combustiveis.values()].map(analisarItem).sort((a, b) => b.vendas - a.vendas);

  const totalVendas = soma(combustiveis, c => c.vendas);
  const totalEntradas = soma(combustiveis, c => c.entradas);
  const totalPerda = soma(combustiveis, c => c.perda);
  const totalGanho = soma(combustiveis, c => c.ganho);
  const totalDisp = soma(combustiveis, c => c.estqAbertura + c.entradas);

  return {
    cnpj: mov.cnpj,
    dtIni: mov.dtIni,
    dtFin: mov.dtFin,
    temBloco1300: mov.temBloco1300,
    totalVendas: round3(totalVendas),
    totalEntradas: round3(totalEntradas),
    totalPerda: round3(totalPerda),
    totalGanho: round3(totalGanho),
    perdaPercentGlobal: totalDisp > 0 ? round4(totalPerda / totalDisp) : 0,
    combustiveis,
    alertas: gerarAlertas(combustiveis),
  };
}

function analisarItem(c: CombustivelMovimento): CombustivelAnalisado {
  const disponivel = c.estqAbertura + c.volEntradas;
  const escritural = round3(c.estqAbertura + c.volEntradas - c.volSaidas - c.perda + c.ganho);
  const estoqueMedio = (c.estqAbertura + c.estqFechamento) / 2;
  const vendaDia = c.dias > 0 ? c.volSaidas / c.dias : 0;
  return {
    codItem: c.codItem,
    descricao: c.descricao,
    ncm: c.ncm,
    estqAbertura: round3(c.estqAbertura),
    entradas: round3(c.volEntradas),
    vendas: round3(c.volSaidas),
    perda: round3(c.perda),
    ganho: round3(c.ganho),
    estqFechamento: round3(c.estqFechamento),
    perdaPercent: disponivel > 0 ? round4(c.perda / disponivel) : 0,
    quebraLiquida: round3(c.ganho - c.perda),
    escrituralFechamento: escritural,
    divergenciaFisicoEscritural: round3(c.estqFechamento - escritural),
    giro: estoqueMedio > 0.001 ? round2(c.volSaidas / estoqueMedio) : 0,
    coberturaDias: vendaDia > 0.001 ? round1(c.estqFechamento / vendaDia) : 0,
  };
}

function gerarAlertas(cs: CombustivelAnalisado[]): string[] {
  const a: string[] = [];
  for (const c of cs) {
    if (c.perdaPercent > PERDA_ALERTA)
      a.push(`${nome(c)}: perda de ${(c.perdaPercent * 100).toFixed(2)}% (${fmtL(c.perda)}) acima do esperado (~0,6%).`);
    if (c.estqFechamento < -0.001)
      a.push(`${nome(c)}: estoque de fechamento NEGATIVO (${fmtL(c.estqFechamento)}).`);
    if (Math.abs(c.divergenciaFisicoEscritural) > Math.max(50, c.entradas * 0.01))
      a.push(`${nome(c)}: divergência físico × escritural de ${fmtL(c.divergenciaFisicoEscritural)}.`);
  }
  return a;
}

const nome = (c: CombustivelAnalisado) => c.descricao || c.codItem;
const fmtL = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} L`;
function soma(arr: CombustivelAnalisado[], f: (c: CombustivelAnalisado) => number): number { return arr.reduce((s, c) => s + f(c), 0); }
function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }
function round3(n: number): number { return Math.round((n + Number.EPSILON) * 1000) / 1000; }
function round4(n: number): number { return Math.round((n + Number.EPSILON) * 10000) / 10000; }
