/**
 * P03 — Fórmulas financeiras puras
 * Todas as funções são puras (sem efeitos colaterais) e retornam Decimal | null.
 * null = dado indisponível ou denominador zero (SAFE_DIV).
 */
import { Decimal } from '@prisma/client/runtime/library';

// ─── Tipos de contexto ─────────────────────────────────────────────────────────

// grupo → subgrupo → valor agregado
export type BalData = Map<string, Map<string, Decimal>>;
// linha_dre → valor
export type DreData = Map<string, Decimal>;

export type Unidade = 'ratio' | 'percentual' | 'dias' | 'reais';

export interface IndicadorCalc {
  indicador: string;
  valor:     Decimal | null;
  unidade:   Unidade;
  fonteOk:   number;          // 0 se alguma fonte for 'inferido'
}

// ─── Primitivas ───────────────────────────────────────────────────────────────

/** Soma todas as linhas do grupo (subgrupo='*') ou de um subgrupo específico. */
export function getBal(bal: BalData, grupo: string, subgrupo: string): Decimal {
  const grupoMap = bal.get(grupo);
  if (!grupoMap) return new Decimal(0);
  if (subgrupo === '*') {
    return [...grupoMap.values()].reduce((acc, v) => acc.add(v), new Decimal(0));
  }
  return grupoMap.get(subgrupo) ?? new Decimal(0);
}

/** Retorna valor de uma linha DRE ou zero se ausente. */
export function getDre(dre: DreData, linhaDre: string): Decimal {
  return dre.get(linhaDre) ?? new Decimal(0);
}

/** Divisão segura — retorna null se denominador for zero ou null. */
export function safeDiv(a: Decimal | null, b: Decimal | null): Decimal | null {
  if (a === null || b === null) return null;
  if (b.isZero()) return null;
  return a.dividedBy(b);
}

// ─── Calculadora de todos os indicadores ─────────────────────────────────────

export function calcularIndicadores(
  bal:     BalData,
  dre:     DreData,
  balAnt?: BalData,   // balanço do exercício anterior (Grupo 6)
  dreAnt?: DreData,   // DRE do exercício anterior (Grupo 6)
  fonteOkGlobal = 1,
): IndicadorCalc[] {
  const r: IndicadorCalc[] = [];
  const fo = fonteOkGlobal;

  // Helper local para não repetir { indicador, valor, unidade, fonteOk }
  const ind = (indicador: string, valor: Decimal | null, unidade: Unidade, fok = fo): IndicadorCalc =>
    ({ indicador, valor, unidade, fonteOk: fok });

  // ── Grupo 1 — Liquidez ────────────────────────────────────────────────────
  const ac  = getBal(bal, 'AC',  '*');
  const pc  = getBal(bal, 'PC',  '*');
  const anc = getBal(bal, 'ANC', '*');
  const pnc = getBal(bal, 'PNC', '*');
  const pl  = getBal(bal, 'PL',  '*');

  const acCaixa     = getBal(bal, 'AC', 'Caixa e Equivalentes');
  const acClientes  = getBal(bal, 'AC', 'Contas a Receber');
  const acEstoques  = getBal(bal, 'AC', 'Estoques');
  const pcFornec    = getBal(bal, 'PC', 'Fornecedores');
  const pcEmpCP     = getBal(bal, 'PC', 'Empréstimos CP');
  const pncEmpLP    = getBal(bal, 'PNC', 'Empréstimos LP');

  r.push(ind('liquidez_corrente', safeDiv(ac, pc), 'ratio'));
  r.push(ind('liquidez_seca',     safeDiv(ac.minus(acEstoques), pc), 'ratio'));
  r.push(ind('liquidez_imediata', safeDiv(acCaixa, pc), 'ratio'));
  r.push(ind('liquidez_geral',    safeDiv(ac.add(anc), pc.add(pnc)), 'ratio'));

  // ── Grupo 2 — Rentabilidade ───────────────────────────────────────────────
  const recLiq   = getDre(dre, 'receita_liquida');
  const recBruta = getDre(dre, 'receita_bruta');
  const lucroLiq = getDre(dre, 'lucro_liquido');
  const ebitda   = getDre(dre, 'ebitda');
  const ebit     = getDre(dre, 'ebit');
  const ativoTot = ac.add(anc);

  r.push(ind('margem_ebitda',   safeDiv(ebitda, recLiq), 'percentual'));
  r.push(ind('margem_liquida',  safeDiv(lucroLiq, recLiq), 'percentual'));
  r.push(ind('roe',             safeDiv(lucroLiq, pl), 'percentual'));
  r.push(ind('roa',             safeDiv(lucroLiq, ativoTot), 'percentual'));
  r.push(ind('giro_ativo',      safeDiv(recLiq, ativoTot), 'ratio'));

  // ── Grupo 3 — Endividamento ───────────────────────────────────────────────
  const divCP  = pcEmpCP;
  const divLP  = pncEmpLP;
  const divTot = divCP.add(divLP);
  const divLiq = divTot.minus(acCaixa);

  r.push(ind('divida_financeira_cp',  divCP,  'reais'));
  r.push(ind('divida_financeira_lp',  divLP,  'reais'));
  r.push(ind('divida_financeira_tot', divTot, 'reais'));
  r.push(ind('caixa_equiv',          acCaixa, 'reais'));
  r.push(ind('divida_liquida',        divLiq, 'reais'));
  r.push(ind('dl_ebitda',             safeDiv(divLiq, ebitda), 'ratio'));

  // ── Grupo 4 — Estrutura de Capital ────────────────────────────────────────
  const passivoTot = pc.add(pnc);
  const despFin    = getDre(dre, 'desp_financeiras');

  r.push(ind('grau_endividamento',       safeDiv(passivoTot, ativoTot), 'ratio'));
  r.push(ind('independencia_financeira', safeDiv(pl, ativoTot), 'ratio'));
  r.push(ind('relacao_ct_cp',            safeDiv(passivoTot, pl), 'ratio'));
  r.push(ind('endiv_bancario_pl',        safeDiv(divTot, pl), 'ratio'));
  r.push(ind('cobertura_juros',          safeDiv(ebit, despFin), 'ratio'));
  r.push(ind('divida_cp_pct',            safeDiv(divCP, divTot), 'percentual'));
  r.push(ind('capital_proprio_pct',      safeDiv(pl, ativoTot), 'percentual'));
  r.push(ind('capital_terceiros_pct',    safeDiv(passivoTot, ativoTot), 'percentual'));

  // ── Grupo 5 — Eficiência Operacional ─────────────────────────────────────
  const cmv = getDre(dre, 'cmv');
  const D   = new Decimal(360);

  const pmr = safeDiv(acClientes.mul(D), recBruta);
  const pme = safeDiv(acEstoques.mul(D), cmv);
  const pmp = safeDiv(pcFornec.mul(D),   cmv);

  let ciclo: Decimal | null = null;
  if (pmr !== null && pme !== null && pmp !== null) {
    ciclo = pmr.add(pme).minus(pmp);
  }

  r.push(ind('pmr',             pmr,   'dias'));
  r.push(ind('pme',             pme,   'dias', cmv.isZero() ? 0 : fo));
  r.push(ind('pmp',             pmp,   'dias', cmv.isZero() ? 0 : fo));
  r.push(ind('ciclo_financeiro', ciclo, 'dias'));

  // ── Grupo 6 — Crescimento (requer histórico) ──────────────────────────────
  if (balAnt && dreAnt) {
    const recLiqAnt  = getDre(dreAnt, 'receita_liquida');
    const ebitdaAnt  = getDre(dreAnt, 'ebitda');
    const plAnt      = getBal(balAnt, 'PL', '*');
    const acAnt      = getBal(balAnt, 'AC', '*');
    const ancAnt     = getBal(balAnt, 'ANC', '*');
    const divTotAnt  = getBal(balAnt, 'PC', 'Empréstimos CP')
                         .add(getBal(balAnt, 'PNC', 'Empréstimos LP'));
    const clientesAnt = getBal(balAnt, 'AC', 'Contas a Receber');
    const estoquesAnt = getBal(balAnt, 'AC', 'Estoques');
    const ativoAnt   = acAnt.add(ancAnt);

    r.push(ind('crescimento_receita',  safeDiv(recLiq.minus(recLiqAnt), recLiqAnt), 'percentual'));
    r.push(ind('crescimento_ebitda',   safeDiv(ebitda.minus(ebitdaAnt), ebitdaAnt), 'percentual'));
    r.push(ind('crescimento_pl',       safeDiv(pl.minus(plAnt), plAnt), 'percentual'));
    r.push(ind('crescimento_divida',   safeDiv(divTot.minus(divTotAnt), divTotAnt), 'percentual'));
    r.push(ind('crescimento_clientes', safeDiv(acClientes.minus(clientesAnt), clientesAnt), 'percentual'));
    r.push(ind('crescimento_estoques', safeDiv(acEstoques.minus(estoquesAnt), estoquesAnt), 'percentual'));
    r.push(ind('crescimento_ativos',   safeDiv(ativoTot.minus(ativoAnt), ativoAnt), 'percentual'));
  } else {
    // Sem ano anterior → NULL garantido (não estimar)
    for (const n of ['crescimento_receita','crescimento_ebitda','crescimento_pl',
                     'crescimento_divida','crescimento_clientes','crescimento_estoques',
                     'crescimento_ativos']) {
      r.push(ind(n, null, 'percentual'));
    }
  }

  return r;
}

/** Monta o snapshot de estrutura de capital (tb_estrutura_capital). */
export function calcularEstruturaCapital(bal: BalData, dre: DreData) {
  const ac      = getBal(bal, 'AC',  '*');
  const anc     = getBal(bal, 'ANC', '*');
  const pc      = getBal(bal, 'PC',  '*');
  const pnc     = getBal(bal, 'PNC', '*');
  const pl      = getBal(bal, 'PL',  '*');
  const divCP   = getBal(bal, 'PC',  'Empréstimos CP');
  const divLP   = getBal(bal, 'PNC', 'Empréstimos LP');
  const caixa   = getBal(bal, 'AC',  'Caixa e Equivalentes');
  const ativo   = ac.add(anc);
  const passivo = pc.add(pnc);
  const divTot  = divCP.add(divLP);
  const divLiq  = divTot.minus(caixa);
  const ebit    = getDre(dre, 'ebit');
  const despFin = getDre(dre, 'desp_financeiras');

  return {
    ativoTotal:              ativo,
    passivoTotal:            passivo,
    pl,
    dividaFinanceiraCp:      divCP,
    dividaFinanceiraLp:      divLP,
    dividaFinanceiraTot:     divTot,
    dividaLiquida:           divLiq,
    capitalProprioPct:       safeDiv(pl, ativo),
    capitalTerceirosPct:     safeDiv(passivo, ativo),
    grauEndividamento:       safeDiv(passivo, ativo),
    independenciaFinanceira: safeDiv(pl, ativo),
    relacaoCtCp:             safeDiv(passivo, pl),
    endivBancarioPl:         safeDiv(divTot, pl),
    coberturaJuros:          safeDiv(ebit, despFin),
    dividaCpPct:             safeDiv(divCP, divTot),
  };
}
