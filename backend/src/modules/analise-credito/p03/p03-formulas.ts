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
  balAnt?: BalData,
  dreAnt?: DreData,
  fonteOkGlobal = 1,
): IndicadorCalc[] {
  const fo = fonteOkGlobal;
  const ind = (indicador: string, valor: Decimal | null, unidade: Unidade, fok = fo): IndicadorCalc =>
    ({ indicador, valor, unidade, fonteOk: fok });

  // ── Saldos de balanço ────────────────────────────────────────────────────────
  const ac       = getBal(bal, 'AC',  '*');
  const pc       = getBal(bal, 'PC',  '*');
  const anc      = getBal(bal, 'ANC', '*');
  const pnc      = getBal(bal, 'PNC', '*');
  const pl       = getBal(bal, 'PL',  '*');

  const acCaixa    = getBal(bal, 'AC',  'Caixa e Equivalentes');
  const acClientes = getBal(bal, 'AC',  'Contas a Receber');
  const acEstoques = getBal(bal, 'AC',  'Estoques');
  const ancRlp     = getBal(bal, 'ANC', 'RLP');
  const pcFornec   = getBal(bal, 'PC',  'Fornecedores');
  const pcEmpCP    = getBal(bal, 'PC',  'Empréstimos CP');
  const pncEmpLP   = getBal(bal, 'PNC', 'Empréstimos LP');
  const ativoTot   = ac.add(anc);

  // ── Linhas DRE ───────────────────────────────────────────────────────────────
  const recLiq   = getDre(dre, 'receita_liquida');
  const recBruta = getDre(dre, 'receita_bruta');
  const lucroLiq = getDre(dre, 'lucro_liquido');
  const ebitda   = getDre(dre, 'ebitda');
  const ebit     = getDre(dre, 'ebit');
  const cmv      = getDre(dre, 'cmv');
  const despFin  = getDre(dre, 'desp_financeiras');

  // ── Grupo 1 — Liquidez ───────────────────────────────────────────────────────
  const grp1: IndicadorCalc[] = [
    ind('liquidez_corrente', safeDiv(ac, pc),                            'ratio'),
    ind('liquidez_seca',     safeDiv(ac.minus(acEstoques), pc),          'ratio'),
    ind('liquidez_imediata', safeDiv(acCaixa, pc),                       'ratio'),
    ind('liquidez_geral',    safeDiv(ac.add(ancRlp), pc.add(pnc)),       'ratio'),
  ];

  // ── Grupo 2 — Rentabilidade ──────────────────────────────────────────────────
  const roeVal = safeDiv(lucroLiq, pl); // Lucro Líquido / PL

  // ROA = Lucro Líquido / Ativo Total Médio
  const ativoAnt   = balAnt ? getBal(balAnt, 'AC', '*').add(getBal(balAnt, 'ANC', '*')) : null;
  const ativoMedio = ativoAnt ? ativoTot.add(ativoAnt).dividedBy(2) : ativoTot;
  const roaVal     = safeDiv(lucroLiq, ativoMedio);

  // ROIC = EBIT / Capital Investido (PL + Dívida Financeira)
  const capitalInvestido = pl.add(pcEmpCP).add(pncEmpLP);
  const roicVal = capitalInvestido.isZero() ? null : safeDiv(ebit, capitalInvestido);

  const grp2: IndicadorCalc[] = [
    ind('margem_ebitda',   safeDiv(ebitda,   recLiq),   'percentual'),
    ind('margem_liquida',  safeDiv(lucroLiq, recLiq),   'percentual'),
    ind('roe',             roeVal,                       'percentual'),
    ind('roa',             roaVal,                       'percentual'),
    ind('roic',            roicVal,                      'percentual'),
    ind('grau_alavancagem',safeDiv(roeVal, roaVal),      'ratio'),        // DuPont ROE/ROA
    ind('giro_ativo',      safeDiv(recLiq, ativoTot),   'ratio'),
  ];

  // ── Grupo 3 — Endividamento ──────────────────────────────────────────────────
  const divCP  = pcEmpCP;
  const divLP  = pncEmpLP;
  const divTot = divCP.add(divLP);
  const divLiq = divTot.minus(acCaixa);

  const grp3: IndicadorCalc[] = [
    ind('divida_financeira_cp',  divCP,                            'reais'),
    ind('divida_financeira_lp',  divLP,                            'reais'),
    ind('divida_financeira_tot', divTot,                           'reais'),
    ind('caixa_equiv',           acCaixa,                          'reais'),
    ind('divida_liquida',        divLiq,                           'reais'),
    ind('dl_ebitda',             safeDiv(divLiq, ebitda),          'ratio'),
  ];

  // ── Grupo 4 — Estrutura de Capital ───────────────────────────────────────────
  const passivoTot = pc.add(pnc);

  const grp4: IndicadorCalc[] = [
    ind('grau_endividamento',        safeDiv(passivoTot, ativoTot), 'ratio'),
    ind('independencia_financeira',  safeDiv(pl, ativoTot),         'ratio'),
    ind('relacao_ct_cp',             safeDiv(passivoTot, pl),       'ratio'),
    ind('endiv_bancario_pl',         safeDiv(divTot, pl),           'ratio'),
    ind('cobertura_juros',           safeDiv(ebit, despFin),        'ratio'),
    ind('divida_cp_pct',             safeDiv(divCP, divTot),        'percentual'),
    ind('capital_proprio_pct',       safeDiv(pl, ativoTot),         'percentual'),
    ind('capital_terceiros_pct',     safeDiv(passivoTot, ativoTot), 'percentual'),
  ];

  // ── Grupo 5 — Eficiência Operacional ─────────────────────────────────────────
  const D   = new Decimal(360);
  const pmr = safeDiv(acClientes.mul(D), recBruta);
  const pme = safeDiv(acEstoques.mul(D), cmv);
  const pmp = safeDiv(pcFornec.mul(D),   cmv);
  const ciclo: Decimal | null = pmr !== null && pme !== null && pmp !== null
    ? pmr.add(pme).minus(pmp)
    : null;

  const grp5: IndicadorCalc[] = [
    ind('pmr',             pmr,   'dias'),
    ind('pme',             pme,   'dias', cmv.isZero() ? 0 : fo),
    ind('pmp',             pmp,   'dias', cmv.isZero() ? 0 : fo),
    ind('ciclo_financeiro', ciclo, 'dias'),
  ];

  // ── Grupo 6 — Crescimento (requer histórico) ──────────────────────────────────
  let grp6: IndicadorCalc[];
  const crescNames = [
    'crescimento_receita', 'crescimento_ebitda', 'crescimento_pl',
    'crescimento_divida',  'crescimento_clientes','crescimento_estoques',
    'crescimento_ativos',
  ] as const;

  if (balAnt && dreAnt) {
    const recLiqAnt   = getDre(dreAnt, 'receita_liquida');
    const ebitdaAnt   = getDre(dreAnt, 'ebitda');
    const plAnt       = getBal(balAnt, 'PL',  '*');
    const acAnt2      = getBal(balAnt, 'AC',  '*');
    const ancAnt2     = getBal(balAnt, 'ANC', '*');
    const divTotAnt   = getBal(balAnt, 'PC',  'Empréstimos CP').add(getBal(balAnt, 'PNC', 'Empréstimos LP'));
    const clientesAnt = getBal(balAnt, 'AC',  'Contas a Receber');
    const estoquesAnt = getBal(balAnt, 'AC',  'Estoques');
    const ativoAnt2   = acAnt2.add(ancAnt2);

    grp6 = [
      ind('crescimento_receita',   safeDiv(recLiq.minus(recLiqAnt),     recLiqAnt),   'percentual'),
      ind('crescimento_ebitda',    safeDiv(ebitda.minus(ebitdaAnt),     ebitdaAnt),   'percentual'),
      ind('crescimento_pl',        safeDiv(pl.minus(plAnt),             plAnt),       'percentual'),
      ind('crescimento_divida',    safeDiv(divTot.minus(divTotAnt),     divTotAnt),   'percentual'),
      ind('crescimento_clientes',  safeDiv(acClientes.minus(clientesAnt),clientesAnt),'percentual'),
      ind('crescimento_estoques',  safeDiv(acEstoques.minus(estoquesAnt),estoquesAnt),'percentual'),
      ind('crescimento_ativos',    safeDiv(ativoTot.minus(ativoAnt2),   ativoAnt2),   'percentual'),
    ];
  } else {
    grp6 = crescNames.map(n => ind(n, null, 'percentual'));
  }

  return [...grp1, ...grp2, ...grp3, ...grp4, ...grp5, ...grp6];
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
