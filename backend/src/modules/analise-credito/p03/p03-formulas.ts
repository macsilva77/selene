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
  const pcTributos = getBal(bal, 'PC',  'Tributos a Pagar');
  const pcSalarios = getBal(bal, 'PC',  'Salários e Encargos');
  const ancImob    = getBal(bal, 'ANC', 'Imobilizado');
  const ancIntang  = getBal(bal, 'ANC', 'Intangível');
  const ativoTot   = ac.add(anc);

  // ── Linhas DRE ───────────────────────────────────────────────────────────────
  const recLiq   = getDre(dre, 'receita_liquida');
  const recBruta = getDre(dre, 'receita_bruta');
  const lucroLiq = getDre(dre, 'lucro_liquido');
  const ebitda   = getDre(dre, 'ebitda');
  const ebit     = getDre(dre, 'ebit');
  const cmv       = getDre(dre, 'cmv');
  const despFin   = getDre(dre, 'desp_financeiras');
  const lucroBruto = getDre(dre, 'lucro_bruto');

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
  // Retorna null quando PL < 0: capital investido líquido perde sentido econômico e gera valores absurdos.
  const capitalInvestido = pl.add(pcEmpCP).add(pncEmpLP);
  const roicVal = (capitalInvestido.isZero() || capitalInvestido.isNegative() || pl.isNegative())
    ? null
    : safeDiv(ebit, capitalInvestido);

  const grp2: IndicadorCalc[] = [
    // Valores absolutos — necessários para CR-01, CR-02, CR-03, CR-06, PO-01
    ind('ebitda',          ebitda,                      'reais'),
    ind('lucro_liquido',   lucroLiq,                    'reais'),
    ind('pl',              pl,                          'reais'),
    // Ratios
    ind('margem_ebitda',   safeDiv(ebitda,   recLiq),   'percentual'),
    ind('margem_liquida',  safeDiv(lucroLiq, recLiq),   'percentual'),
    ind('roe',             roeVal,                       'percentual'),
    ind('roa',             roaVal,                       'percentual'),
    ind('roic',            roicVal,                      'percentual'),
    ind('grau_alavancagem',    safeDiv(roeVal, roaVal),      'ratio'),
    ind('giro_ativo',          safeDiv(recLiq, ativoTot),   'ratio'),
    // Cascata de margens (bruta → EBIT → EBITDA → líquida)
    ind('margem_bruta',        safeDiv(lucroBruto, recLiq), 'percentual'),
    ind('margem_ebit',         safeDiv(ebit,       recLiq), 'percentual'),
    ind('cobertura_ebitda_df', safeDiv(ebitda, despFin),    'ratio'),
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
    // Dívida Líquida/EBITDA só faz sentido com EBITDA > 0. Com EBITDA ≤ 0
    // (prejuízo operacional) o múltiplo é absurdo (negativo) ou enganoso →
    // retorna null para o front ocultar o indicador/selo em vez de exibir alavancagem falsa.
    ind('dl_ebitda',             ebitda.greaterThan(0) ? safeDiv(divLiq, ebitda) : null, 'ratio'),
    // Valores absolutos de ativo operacional (usados na composição do ativo)
    ind('ativo_clientes',        acClientes,                       'reais'),
    ind('ativo_estoques',        acEstoques,                       'reais'),
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

  // ── Grupo 7 — Capital de Giro / Modelo Fleuriet ──────────────────────────────
  // CDG = AC - PC; NCG = (Clientes + Estoques) - (Fornecedores + Tributos + Salários)
  // Tesouraria = CDG - NCG; T > 0 = empresa autofinanciada no giro operacional
  const ativoFixo = ancImob.add(ancIntang);
  const cdg       = ac.minus(pc);
  const ncg       = acClientes.add(acEstoques)
                      .minus(pcFornec).minus(pcTributos).minus(pcSalarios);
  const tesouraria = cdg.minus(ncg);

  const grp7: IndicadorCalc[] = [
    ind('ativo_imobilizado',  ativoFixo,  'reais'),
    ind('capital_giro',       cdg,        'reais'),
    ind('ncg',                ncg,        'reais'),
    ind('saldo_tesouraria',   tesouraria, 'reais'),
  ];

  // ── Grupo 8 — Imobilização ────────────────────────────────────────────────────
  const plPnc = pl.add(pnc);

  const grp8: IndicadorCalc[] = [
    // null quando PL ≤ 0: denominador negativo inverte o sinal e perde sentido
    ind('imobilizacao_pl',
      pl.isNegative() || pl.isZero() ? null : safeDiv(ativoFixo, pl),
      'ratio'),
    // null quando PL + PNC ≤ 0: recursos permanentes insuficientes
    ind('imobilizacao_rec_perm',
      plPnc.isNegative() || plPnc.isZero() ? null : safeDiv(ativoFixo, plPnc),
      'ratio'),
    ind('imob_ativo_pct', safeDiv(ativoFixo,      ativoTot),  'percentual'),
    ind('pm_tributos',    safeDiv(pcTributos.mul(D), recBruta), 'dias'),
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
      // usa plAnt.abs() no denominador: quando plAnt < 0 a fórmula padrão (÷plAnt) inverte o sinal
      // e gera crescimento positivo para PL que piorou (ex: −55.9K → −64.9K daria falsos +16.1%)
      ind('crescimento_pl',        safeDiv(pl.minus(plAnt),             plAnt.abs()),  'percentual'),
      ind('crescimento_divida',    safeDiv(divTot.minus(divTotAnt),     divTotAnt),   'percentual'),
      ind('crescimento_clientes',  safeDiv(acClientes.minus(clientesAnt),clientesAnt),'percentual'),
      ind('crescimento_estoques',  safeDiv(acEstoques.minus(estoquesAnt),estoquesAnt),'percentual'),
      ind('crescimento_ativos',    safeDiv(ativoTot.minus(ativoAnt2),   ativoAnt2),   'percentual'),
    ];
  } else {
    grp6 = crescNames.map(n => ind(n, null, 'percentual'));
  }

  return [...grp1, ...grp2, ...grp3, ...grp4, ...grp5, ...grp7, ...grp8, ...grp6];
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
