/**
 * P04 — Regras determinísticas de classificação de risco.
 * Todas as funções são puras. Retornam AlertaRow | null.
 * null = indicador requerido ausente (input NULL em tb_indicadores).
 *
 * Convenções:
 *   ind(nome)     → valor do indicador no exercício atual (Decimal | null)
 *   indAnt(nome)  → valor no exercício anterior (Decimal | null)
 *   série         → array de valores por exercício ASC (para janelas deslizantes)
 */
import { Decimal } from '@prisma/client/runtime/library';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type Severidade = 'critico' | 'atencao' | 'positivo';

export interface AlertaRow {
  codigoRegra: string;
  severidade:  Severidade;
  indicador:   string;
  valorAtual:  Decimal | null;
  mensagem:    string;
  categoria:   string;
  regraOk:     number;
}

// Contexto de entrada para avaliação das regras
export interface RegraCtx {
  ind:    (nome: string) => Decimal | null;
  indAnt: (nome: string) => Decimal | null;
  // Série de valores de um indicador em exercícios ASC (incluindo atual)
  serie:  (nome: string) => (Decimal | null)[];
  // fonteOk do indicador (0 = inferido)
  fonte:  (nome: string) => number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const pct = (d: Decimal) => `${d.mul(100).toFixed(1)}%`;
const val = (d: Decimal, casas = 2) => `R$ ${d.toFixed(casas)}`;
const rat = (d: Decimal) => `${d.toFixed(2)}x`;

function fonteOk(ctx: RegraCtx, ...nomes: string[]): number {
  return nomes.every(n => ctx.fonte(n) === 1) ? 1 : 0;
}

// Conta exercícios consecutivos (mais recentes) onde pred é true
function consecutivosRecentes(serie: (Decimal | null)[], pred: (v: Decimal) => boolean): number {
  let count = 0;
  for (let i = serie.length - 1; i >= 0; i--) {
    const v = serie[i];
    if (v !== null && pred(v)) count++;
    else break;
  }
  return count;
}

// ─── Regras CRÍTICAS (CR) ─────────────────────────────────────────────────────

function cr01(ctx: RegraCtx): AlertaRow | null {
  const pl = ctx.ind('pl');
  if (pl === null) return null;
  if (!pl.isNegative()) return null;
  return { codigoRegra: 'CR-01', severidade: 'critico', indicador: 'pl',
    valorAtual: pl, categoria: 'solvência',
    mensagem: `Patrimônio Líquido negativo (${val(pl)})`,
    regraOk: fonteOk(ctx, 'pl') };
}

function cr02(ctx: RegraCtx): AlertaRow | null {
  const pl    = ctx.ind('pl');
  const ativo = ctx.ind('roa'); // proxy: se roa existe, ativo total foi calculado
  const grau  = ctx.ind('grau_endividamento');
  const indep = ctx.ind('independencia_financeira');
  if (indep === null || pl === null) return null;
  if (pl.isNegative() || indep.greaterThanOrEqualTo(0.05)) return null;
  return { codigoRegra: 'CR-02', severidade: 'critico', indicador: 'independencia_financeira',
    valorAtual: indep, categoria: 'solvência',
    mensagem: `PL representa menos de 5% do ativo total (${pct(indep)})`,
    regraOk: fonteOk(ctx, 'independencia_financeira', 'pl') };
}

function cr03(ctx: RegraCtx): AlertaRow | null {
  const serie = ctx.serie('lucro_liquido'); // valores ASC
  // Filtra nulos para evitar quebra de sequência por dado ausente
  const n = consecutivosRecentes(serie, v => v.isNegative());
  if (n < 2) return null;
  const atual = ctx.ind('lucro_liquido');
  return { codigoRegra: 'CR-03', severidade: 'critico', indicador: 'lucro_liquido',
    valorAtual: atual, categoria: 'rentabilidade',
    mensagem: `Prejuízo líquido nos últimos ${n} exercícios consecutivos`,
    regraOk: fonteOk(ctx, 'lucro_liquido') };
}

function cr04(ctx: RegraCtx): AlertaRow | null {
  const lc = ctx.ind('liquidez_corrente');
  if (lc === null) return null;
  if (!lc.lessThan(1)) return null;
  return { codigoRegra: 'CR-04', severidade: 'critico', indicador: 'liquidez_corrente',
    valorAtual: lc, categoria: 'liquidez',
    mensagem: `Liquidez corrente de ${rat(lc)} — passivo circulante supera ativo circulante`,
    regraOk: fonteOk(ctx, 'liquidez_corrente') };
}

function cr05(ctx: RegraCtx): AlertaRow | null {
  const dlE = ctx.ind('dl_ebitda');
  if (dlE === null) return null;
  if (!dlE.greaterThan(4)) return null;
  return { codigoRegra: 'CR-05', severidade: 'critico', indicador: 'dl_ebitda',
    valorAtual: dlE, categoria: 'endividamento',
    mensagem: `Dívida Líquida/EBITDA de ${dlE.toFixed(1)}x — acima do limite crítico de 4x`,
    regraOk: fonteOk(ctx, 'dl_ebitda') };
}

function cr06(ctx: RegraCtx): AlertaRow | null {
  const ebitda = ctx.ind('ebitda');
  if (ebitda === null) return null;
  if (ebitda.greaterThan(0)) return null;
  return { codigoRegra: 'CR-06', severidade: 'critico', indicador: 'ebitda',
    valorAtual: ebitda, categoria: 'geração de caixa',
    mensagem: `EBITDA negativo ou nulo (${val(ebitda)})`,
    regraOk: fonteOk(ctx, 'ebitda') };
}

function cr07(ctx: RegraCtx): AlertaRow | null {
  const cj = ctx.ind('cobertura_juros');
  if (cj === null) return null;
  if (!cj.lessThan(1)) return null;
  return { codigoRegra: 'CR-07', severidade: 'critico', indicador: 'cobertura_juros',
    valorAtual: cj, categoria: 'capacidade de pagamento',
    mensagem: `Cobertura de juros de ${cj.toFixed(1)}x — EBIT insuficiente para cobrir despesas financeiras`,
    regraOk: fonteOk(ctx, 'cobertura_juros') };
}

function cr08(ctx: RegraCtx): AlertaRow | null {
  const ctcp    = ctx.ind('relacao_ct_cp');
  const ctcpAnt = ctx.indAnt('relacao_ct_cp');
  if (ctcp === null || ctcpAnt === null) return null;
  if (!ctcp.greaterThan(3)) return null;
  if (!ctcp.greaterThan(ctcpAnt)) return null;
  return { codigoRegra: 'CR-08', severidade: 'critico', indicador: 'relacao_ct_cp',
    valorAtual: ctcp, categoria: 'estrutura de capital',
    mensagem: `CT/CP de ${ctcp.toFixed(1)}x com tendência crescente — risco estrutural`,
    regraOk: fonteOk(ctx, 'relacao_ct_cp') };
}

// ─── Regras ATENÇÃO (AT) ──────────────────────────────────────────────────────

function at01(ctx: RegraCtx): AlertaRow | null {
  const cr = ctx.ind('crescimento_receita');
  if (cr === null) return null;
  if (!cr.lessThan(-0.10)) return null;
  return { codigoRegra: 'AT-01', severidade: 'atencao', indicador: 'crescimento_receita',
    valorAtual: cr, categoria: 'desempenho operacional',
    mensagem: `Receita caiu ${pct(cr.abs())} em relação ao exercício anterior`,
    regraOk: fonteOk(ctx, 'crescimento_receita') };
}

function at02(ctx: RegraCtx): AlertaRow | null {
  const cCli = ctx.ind('crescimento_clientes');
  const cRec = ctx.ind('crescimento_receita');
  if (cCli === null || cRec === null) return null;
  if (!cCli.greaterThan(cRec)) return null;
  return { codigoRegra: 'AT-02', severidade: 'atencao', indicador: 'crescimento_clientes',
    valorAtual: cCli, categoria: 'qualidade do balanço',
    mensagem: `Clientes cresceram ${pct(cCli)} enquanto receita cresceu ${pct(cRec)}`,
    regraOk: fonteOk(ctx, 'crescimento_clientes', 'crescimento_receita') };
}

function at03(ctx: RegraCtx): AlertaRow | null {
  const cEst = ctx.ind('crescimento_estoques');
  const cRec = ctx.ind('crescimento_receita');
  if (cEst === null || cRec === null) return null;
  if (!cEst.greaterThan(0.30)) return null;
  if (!cRec.lessThan(cEst)) return null;
  return { codigoRegra: 'AT-03', severidade: 'atencao', indicador: 'crescimento_estoques',
    valorAtual: cEst, categoria: 'qualidade do balanço',
    mensagem: `Estoques cresceram ${pct(cEst)} sem crescimento equivalente de receita`,
    regraOk: fonteOk(ctx, 'crescimento_estoques', 'crescimento_receita') };
}

function at04(ctx: RegraCtx): AlertaRow | null {
  const mE    = ctx.ind('margem_ebitda');
  const ebitda = ctx.ind('ebitda');
  if (mE === null || ebitda === null) return null;
  if (!mE.lessThan(0.08) || !ebitda.greaterThan(0)) return null;
  return { codigoRegra: 'AT-04', severidade: 'atencao', indicador: 'margem_ebitda',
    valorAtual: mE, categoria: 'rentabilidade',
    mensagem: `Margem EBITDA de ${pct(mE)} — abaixo do patamar mínimo de 8%`,
    regraOk: fonteOk(ctx, 'margem_ebitda') };
}

function at05(ctx: RegraCtx): AlertaRow | null {
  const lc = ctx.ind('liquidez_corrente');
  if (lc === null) return null;
  if (!lc.greaterThanOrEqualTo(1) || !lc.lessThan(1.2)) return null;
  return { codigoRegra: 'AT-05', severidade: 'atencao', indicador: 'liquidez_corrente',
    valorAtual: lc, categoria: 'liquidez',
    mensagem: `Liquidez corrente de ${rat(lc)} — margem estreita`,
    regraOk: fonteOk(ctx, 'liquidez_corrente') };
}

function at06(ctx: RegraCtx): AlertaRow | null {
  const dcp = ctx.ind('divida_cp_pct');
  const lc  = ctx.ind('liquidez_corrente');
  if (dcp === null || lc === null) return null;
  if (!dcp.greaterThan(0.60) || !lc.lessThan(1.3)) return null;
  return { codigoRegra: 'AT-06', severidade: 'atencao', indicador: 'divida_cp_pct',
    valorAtual: dcp, categoria: 'estrutura de capital',
    mensagem: `Dívida CP representa ${pct(dcp)} da dívida com liquidez corrente de ${rat(lc)}`,
    regraOk: fonteOk(ctx, 'divida_cp_pct', 'liquidez_corrente') };
}

function at07(ctx: RegraCtx): AlertaRow | null {
  const cj = ctx.ind('cobertura_juros');
  if (cj === null) return null;
  if (!cj.greaterThanOrEqualTo(1) || !cj.lessThan(1.5)) return null;
  return { codigoRegra: 'AT-07', severidade: 'atencao', indicador: 'cobertura_juros',
    valorAtual: cj, categoria: 'capacidade de pagamento',
    mensagem: `Cobertura de juros de ${cj.toFixed(1)}x — margem estreita para servir a dívida`,
    regraOk: fonteOk(ctx, 'cobertura_juros') };
}

function at08(ctx: RegraCtx): AlertaRow | null {
  const cf    = ctx.ind('ciclo_financeiro');
  const cfAnt = ctx.indAnt('ciclo_financeiro');
  if (cf === null || cfAnt === null || cfAnt.isZero()) return null;
  if (!cf.greaterThan(cfAnt.mul(1.15))) return null;
  return { codigoRegra: 'AT-08', severidade: 'atencao', indicador: 'ciclo_financeiro',
    valorAtual: cf, categoria: 'eficiência operacional',
    mensagem: `Ciclo financeiro cresceu de ${cfAnt.toFixed(0)} para ${cf.toFixed(0)} dias — maior consumo de capital de giro`,
    regraOk: fonteOk(ctx, 'ciclo_financeiro') };
}

// ─── Regras POSITIVAS (PO) ────────────────────────────────────────────────────

function po01(ctx: RegraCtx): AlertaRow | null {
  const serie = ctx.serie('ebitda');
  let count = 0;
  for (let i = serie.length - 1; i >= 1; i--) {
    const atual = serie[i];
    const ant   = serie[i - 1];
    if (atual !== null && ant !== null && atual.greaterThan(ant)) count++;
    else break;
  }
  if (count < 3) return null;
  const ebitda = ctx.ind('ebitda');
  return { codigoRegra: 'PO-01', severidade: 'positivo', indicador: 'ebitda',
    valorAtual: ebitda, categoria: 'geração de caixa',
    mensagem: `EBITDA crescente nos últimos ${count} exercícios consecutivos`,
    regraOk: fonteOk(ctx, 'ebitda') };
}

function po02(ctx: RegraCtx): AlertaRow | null {
  const cd = ctx.ind('crescimento_divida');
  if (cd === null) return null;
  if (!cd.isNegative()) return null;
  return { codigoRegra: 'PO-02', severidade: 'positivo', indicador: 'crescimento_divida',
    valorAtual: cd, categoria: 'estrutura de capital',
    mensagem: `Dívida financeira reduziu ${pct(cd.abs())} em relação ao exercício anterior`,
    regraOk: fonteOk(ctx, 'crescimento_divida') };
}

function po03(ctx: RegraCtx): AlertaRow | null {
  const mE = ctx.ind('margem_ebitda');
  if (mE === null) return null;
  if (!mE.greaterThan(0.15)) return null;
  return { codigoRegra: 'PO-03', severidade: 'positivo', indicador: 'margem_ebitda',
    valorAtual: mE, categoria: 'rentabilidade',
    mensagem: `Margem EBITDA de ${pct(mE)} — acima do patamar de excelência de 15%`,
    regraOk: fonteOk(ctx, 'margem_ebitda') };
}

function po04(ctx: RegraCtx): AlertaRow | null {
  const dlE = ctx.ind('dl_ebitda');
  if (dlE === null) return null;
  if (!dlE.lessThan(1.5)) return null;
  return { codigoRegra: 'PO-04', severidade: 'positivo', indicador: 'dl_ebitda',
    valorAtual: dlE, categoria: 'endividamento',
    mensagem: `Dívida Líquida/EBITDA de ${dlE.toFixed(1)}x — baixíssima alavancagem`,
    regraOk: fonteOk(ctx, 'dl_ebitda') };
}

function po05(ctx: RegraCtx): AlertaRow | null {
  const indep = ctx.ind('independencia_financeira');
  if (indep === null) return null;
  if (!indep.greaterThan(0.50)) return null;
  return { codigoRegra: 'PO-05', severidade: 'positivo', indicador: 'independencia_financeira',
    valorAtual: indep, categoria: 'estrutura de capital',
    mensagem: `Independência financeira de ${pct(indep)} — PL financia a maioria dos ativos`,
    regraOk: fonteOk(ctx, 'independencia_financeira') };
}

function po06(ctx: RegraCtx): AlertaRow | null {
  const cj = ctx.ind('cobertura_juros');
  if (cj === null) return null;
  if (!cj.greaterThan(3)) return null;
  return { codigoRegra: 'PO-06', severidade: 'positivo', indicador: 'cobertura_juros',
    valorAtual: cj, categoria: 'capacidade de pagamento',
    mensagem: `Cobertura de juros de ${cj.toFixed(1)}x — ampla capacidade de servir a dívida`,
    regraOk: fonteOk(ctx, 'cobertura_juros') };
}

function po07(ctx: RegraCtx): AlertaRow | null {
  const cf    = ctx.ind('ciclo_financeiro');
  const cfAnt = ctx.indAnt('ciclo_financeiro');
  if (cf === null || cfAnt === null) return null;
  if (!cf.lessThan(cfAnt)) return null;
  return { codigoRegra: 'PO-07', severidade: 'positivo', indicador: 'ciclo_financeiro',
    valorAtual: cf, categoria: 'eficiência operacional',
    mensagem: `Ciclo financeiro reduziu de ${cfAnt.toFixed(0)} para ${cf.toFixed(0)} dias — maior eficiência operacional`,
    regraOk: fonteOk(ctx, 'ciclo_financeiro') };
}

function po08(ctx: RegraCtx): AlertaRow | null {
  const cpl = ctx.ind('crescimento_pl');
  if (cpl === null) return null;
  if (!cpl.greaterThan(0.15)) return null;
  return { codigoRegra: 'PO-08', severidade: 'positivo', indicador: 'crescimento_pl',
    valorAtual: cpl, categoria: 'solvência',
    mensagem: `Patrimônio Líquido cresceu ${pct(cpl)} — fortalecimento do capital próprio`,
    regraOk: fonteOk(ctx, 'crescimento_pl') };
}

// ─── Avaliador principal ──────────────────────────────────────────────────────

export function avaliarRegras(ctx: RegraCtx): AlertaRow[] {
  const fns = [
    cr01, cr02, cr03, cr04, cr05, cr06, cr07, cr08,
    at01, at02, at03, at04, at05, at06, at07, at08, at09,
    po01, po02, po03, po04, po05, po06, po07, po08,
  ];
  return fns.map(fn => fn(ctx)).filter((a): a is AlertaRow => a !== null);
}

// ─── Matriz de classificação ──────────────────────────────────────────────────

export type Classificacao = 'BAIXO' | 'MEDIO_BAIXO' | 'MEDIO' | 'MEDIO_ALTO' | 'ALTO';
const CLASS_NUM: Record<Classificacao, number> = {
  BAIXO: 1, MEDIO_BAIXO: 2, MEDIO: 3, MEDIO_ALTO: 4, ALTO: 5,
};

export interface ClassificacaoResult {
  classificacao:    Classificacao;
  classificacaoNum: number;
  overrideAplicado: number;
  motivoOverride:   string | null;
}

export function classificar(
  alertas:  AlertaRow[],
  percInferido: number,   // fração de indicadores com fonte_ok=0
): { classificacao: ClassificacaoResult; confiabilidade: string } {
  const criticos  = alertas.filter(a => a.severidade === 'critico').map(a => a.codigoRegra);
  const atencao   = alertas.filter(a => a.severidade === 'atencao');
  const positivos = alertas.filter(a => a.severidade === 'positivo');
  const nc = criticos.length;
  const na = atencao.length;

  // Matriz base
  let cls: Classificacao;
  if (nc >= 3)                    cls = 'ALTO';
  else if (nc >= 1 && na >= 3)    cls = 'ALTO';
  else if (nc === 2)              cls = 'MEDIO_ALTO';
  else if (nc === 1 && na >= 1)   cls = 'MEDIO_ALTO';
  else if (nc === 1)              cls = 'MEDIO';
  else if (na >= 4)               cls = 'MEDIO';
  else if (na >= 2)               cls = 'MEDIO_BAIXO';
  else                            cls = 'BAIXO';

  // Override imediato
  let override = 0;
  let motivoOverride: string | null = null;

  const temCR01 = criticos.includes('CR-01');
  const temCR06 = criticos.includes('CR-06');
  const temCR04 = criticos.includes('CR-04');
  const temCR07 = criticos.includes('CR-07');

  if (temCR01 && CLASS_NUM[cls] < CLASS_NUM['ALTO']) {
    cls = 'ALTO'; override = 1; motivoOverride = 'CR-01 (PL negativo)';
  } else if (temCR06 && CLASS_NUM[cls] < CLASS_NUM['ALTO']) {
    cls = 'ALTO'; override = 1; motivoOverride = 'CR-06 (EBITDA negativo ou nulo)';
  } else if (temCR04 && temCR07 && CLASS_NUM[cls] < CLASS_NUM['ALTO']) {
    cls = 'ALTO'; override = 1; motivoOverride = 'CR-04 + CR-07 (LC < 1 e cobertura de juros < 1)';
  }

  const confiabilidade =
    percInferido === 0    ? 'alta'  :
    percInferido <= 0.20  ? 'media' : 'baixa';

  return {
    classificacao: {
      classificacao:    cls,
      classificacaoNum: CLASS_NUM[cls],
      overrideAplicado: override,
      motivoOverride,
    },
    confiabilidade,
  };
}
