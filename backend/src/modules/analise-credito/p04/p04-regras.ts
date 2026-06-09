/**
 * P04 — Regras determinísticas de classificação de risco.
 * Todas as funções são puras. Retornam AlertaRow | null.
 * null = indicador requerido ausente (input NULL em tb_indicadores) ou regra inativa.
 *
 * RegraCfg é carregada da tabela credito_regras (editável via tela de manutenção).
 * A lógica de avaliação permanece em código; thresholds, mensagem e severidade vêm do banco.
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

export interface RegraCtx {
  ind:    (nome: string) => Decimal | null;
  indAnt: (nome: string) => Decimal | null;
  serie:  (nome: string) => (Decimal | null)[];
  fonte:  (nome: string) => number;
}

export interface RegraCfg {
  threshold1?:       number | null;
  threshold2?:       number | null;
  severidade:        string;
  templateMensagem:  string;
  ativo:             boolean;
}

export type ConfigMap = Map<string, RegraCfg>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const pct = (d: Decimal) => `${d.mul(100).toFixed(1)}%`;
const rat = (d: Decimal) => `${d.toFixed(2)}x`;

function renderMsg(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

function fonteOk(ctx: RegraCtx, ...nomes: string[]): number {
  return nomes.every(n => ctx.fonte(n) === 1) ? 1 : 0;
}

function consecutivosRecentes(serie: (Decimal | null)[], pred: (v: Decimal) => boolean): number {
  let count = 0;
  for (let i = serie.length - 1; i >= 0; i--) {
    const v = serie[i];
    if (v !== null && pred(v)) count++;
    else break;
  }
  return count;
}

function cfg(map: ConfigMap, code: string): RegraCfg | null {
  const c = map.get(code);
  return c?.ativo ? c : null;
}

// ─── Regras CRÍTICAS ──────────────────────────────────────────────────────────

function cr01(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'CR-01'); if (!c) return null;
  const pl = ctx.ind('pl');
  if (pl === null || !pl.isNegative()) return null;
  return { codigoRegra: 'CR-01', severidade: c.severidade as Severidade, indicador: 'pl',
    valorAtual: pl, categoria: 'solvência', regraOk: fonteOk(ctx, 'pl'),
    mensagem: renderMsg(c.templateMensagem, { val: pl.toFixed(2) }) };
}

function cr02(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'CR-02'); if (!c) return null;
  const th = c.threshold1 ?? 0.05;
  const pl    = ctx.ind('pl');
  const indep = ctx.ind('independencia_financeira');
  if (indep === null || pl === null) return null;
  if (pl.isNegative() || indep.greaterThanOrEqualTo(th)) return null;
  return { codigoRegra: 'CR-02', severidade: c.severidade as Severidade, indicador: 'independencia_financeira',
    valorAtual: indep, categoria: 'solvência', regraOk: fonteOk(ctx, 'independencia_financeira', 'pl'),
    mensagem: renderMsg(c.templateMensagem, { val: pct(indep), th1pct: `${(th * 100).toFixed(0)}%` }) };
}

function cr03(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'CR-03'); if (!c) return null;
  const minConsec = c.threshold1 ?? 2;
  const serie = ctx.serie('lucro_liquido');
  const n = consecutivosRecentes(serie, v => v.isNegative());
  if (n < minConsec) return null;
  const atual = ctx.ind('lucro_liquido');
  return { codigoRegra: 'CR-03', severidade: c.severidade as Severidade, indicador: 'lucro_liquido',
    valorAtual: atual, categoria: 'rentabilidade', regraOk: fonteOk(ctx, 'lucro_liquido'),
    mensagem: renderMsg(c.templateMensagem, { n: String(n) }) };
}

function cr04(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'CR-04'); if (!c) return null;
  const th = c.threshold1 ?? 1;
  const lc = ctx.ind('liquidez_corrente');
  if (lc === null || !lc.lessThan(th)) return null;
  return { codigoRegra: 'CR-04', severidade: c.severidade as Severidade, indicador: 'liquidez_corrente',
    valorAtual: lc, categoria: 'liquidez', regraOk: fonteOk(ctx, 'liquidez_corrente'),
    mensagem: renderMsg(c.templateMensagem, { val: rat(lc), th1: String(th) }) };
}

function cr05(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'CR-05'); if (!c) return null;
  const th = c.threshold1 ?? 4;
  const dlE = ctx.ind('dl_ebitda');
  if (dlE === null || !dlE.greaterThan(th)) return null;
  return { codigoRegra: 'CR-05', severidade: c.severidade as Severidade, indicador: 'dl_ebitda',
    valorAtual: dlE, categoria: 'endividamento', regraOk: fonteOk(ctx, 'dl_ebitda'),
    mensagem: renderMsg(c.templateMensagem, { val: dlE.toFixed(1), th1: String(th) }) };
}

function cr06(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'CR-06'); if (!c) return null;
  const ebitda = ctx.ind('ebitda');
  if (ebitda === null || ebitda.greaterThan(0)) return null;
  return { codigoRegra: 'CR-06', severidade: c.severidade as Severidade, indicador: 'ebitda',
    valorAtual: ebitda, categoria: 'geração de caixa', regraOk: fonteOk(ctx, 'ebitda'),
    mensagem: renderMsg(c.templateMensagem, { val: ebitda.toFixed(2) }) };
}

function cr07(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'CR-07'); if (!c) return null;
  const th = c.threshold1 ?? 1;
  const cj = ctx.ind('cobertura_juros');
  if (cj === null || !cj.lessThan(th)) return null;
  return { codigoRegra: 'CR-07', severidade: c.severidade as Severidade, indicador: 'cobertura_juros',
    valorAtual: cj, categoria: 'capacidade de pagamento', regraOk: fonteOk(ctx, 'cobertura_juros'),
    mensagem: renderMsg(c.templateMensagem, { val: cj.toFixed(1) }) };
}

function cr08(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'CR-08'); if (!c) return null;
  const th      = c.threshold1 ?? 3;
  const ctcp    = ctx.ind('relacao_ct_cp');
  const ctcpAnt = ctx.indAnt('relacao_ct_cp');
  const pl      = ctx.ind('pl');
  if (ctcp === null || ctcpAnt === null || pl === null) return null;
  // PL ≤ 0: CT/CP não tem sentido econômico (denominador negativo → ratio negativo);
  // a situação já é coberta por CR-01 (PL negativo).
  if (!pl.greaterThan(0)) return null;
  if (!ctcp.greaterThan(th) || !ctcp.greaterThan(ctcpAnt)) return null;
  return { codigoRegra: 'CR-08', severidade: c.severidade as Severidade, indicador: 'relacao_ct_cp',
    valorAtual: ctcp, categoria: 'estrutura de capital', regraOk: fonteOk(ctx, 'relacao_ct_cp'),
    mensagem: renderMsg(c.templateMensagem, { val: ctcp.toFixed(1) }) };
}

// ─── Regras ATENÇÃO ───────────────────────────────────────────────────────────

function at01(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'AT-01'); if (!c) return null;
  const th = c.threshold1 ?? -0.10;
  const cr = ctx.ind('crescimento_receita');
  if (cr === null || !cr.lessThan(th)) return null;
  return { codigoRegra: 'AT-01', severidade: c.severidade as Severidade, indicador: 'crescimento_receita',
    valorAtual: cr, categoria: 'desempenho operacional', regraOk: fonteOk(ctx, 'crescimento_receita'),
    mensagem: renderMsg(c.templateMensagem, { val: pct(cr), valAbs: pct(cr.abs()) }) };
}

function at02(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'AT-02'); if (!c) return null;
  const cCli = ctx.ind('crescimento_clientes');
  const cRec = ctx.ind('crescimento_receita');
  if (cCli === null || cRec === null || !cCli.greaterThan(cRec)) return null;
  return { codigoRegra: 'AT-02', severidade: c.severidade as Severidade, indicador: 'crescimento_clientes',
    valorAtual: cCli, categoria: 'qualidade do balanço', regraOk: fonteOk(ctx, 'crescimento_clientes', 'crescimento_receita'),
    mensagem: renderMsg(c.templateMensagem, { val: pct(cCli), val2: pct(cRec) }) };
}

function at03(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'AT-03'); if (!c) return null;
  const th = c.threshold1 ?? 0.30;
  const cEst = ctx.ind('crescimento_estoques');
  const cRec = ctx.ind('crescimento_receita');
  if (cEst === null || cRec === null) return null;
  if (!cEst.greaterThan(th) || !cRec.lessThan(cEst)) return null;
  return { codigoRegra: 'AT-03', severidade: c.severidade as Severidade, indicador: 'crescimento_estoques',
    valorAtual: cEst, categoria: 'qualidade do balanço', regraOk: fonteOk(ctx, 'crescimento_estoques', 'crescimento_receita'),
    mensagem: renderMsg(c.templateMensagem, { val: pct(cEst) }) };
}

function at04(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'AT-04'); if (!c) return null;
  const th = c.threshold1 ?? 0.08;
  const mE    = ctx.ind('margem_ebitda');
  const ebitda = ctx.ind('ebitda');
  if (mE === null || ebitda === null) return null;
  if (!mE.lessThan(th) || !ebitda.greaterThan(0)) return null;
  return { codigoRegra: 'AT-04', severidade: c.severidade as Severidade, indicador: 'margem_ebitda',
    valorAtual: mE, categoria: 'rentabilidade', regraOk: fonteOk(ctx, 'margem_ebitda'),
    mensagem: renderMsg(c.templateMensagem, { val: pct(mE), th1pct: `${(th * 100).toFixed(0)}%` }) };
}

function at05(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'AT-05'); if (!c) return null;
  const lo = c.threshold1 ?? 1.0;
  const hi = c.threshold2 ?? 1.2;
  const lc = ctx.ind('liquidez_corrente');
  if (lc === null || !lc.greaterThanOrEqualTo(lo) || !lc.lessThan(hi)) return null;
  return { codigoRegra: 'AT-05', severidade: c.severidade as Severidade, indicador: 'liquidez_corrente',
    valorAtual: lc, categoria: 'liquidez', regraOk: fonteOk(ctx, 'liquidez_corrente'),
    mensagem: renderMsg(c.templateMensagem, { val: rat(lc) }) };
}

function at06(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'AT-06'); if (!c) return null;
  const thDcp = c.threshold1 ?? 0.60;
  const thLc  = c.threshold2 ?? 1.3;
  const dcp = ctx.ind('divida_cp_pct');
  const lc  = ctx.ind('liquidez_corrente');
  if (dcp === null || lc === null) return null;
  if (!dcp.greaterThan(thDcp) || !lc.lessThan(thLc)) return null;
  return { codigoRegra: 'AT-06', severidade: c.severidade as Severidade, indicador: 'divida_cp_pct',
    valorAtual: dcp, categoria: 'estrutura de capital', regraOk: fonteOk(ctx, 'divida_cp_pct', 'liquidez_corrente'),
    mensagem: renderMsg(c.templateMensagem, { val: pct(dcp), val2: rat(lc) }) };
}

function at07(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'AT-07'); if (!c) return null;
  const lo = c.threshold1 ?? 1.0;
  const hi = c.threshold2 ?? 1.5;
  const cj = ctx.ind('cobertura_juros');
  if (cj === null || !cj.greaterThanOrEqualTo(lo) || !cj.lessThan(hi)) return null;
  return { codigoRegra: 'AT-07', severidade: c.severidade as Severidade, indicador: 'cobertura_juros',
    valorAtual: cj, categoria: 'capacidade de pagamento', regraOk: fonteOk(ctx, 'cobertura_juros'),
    mensagem: renderMsg(c.templateMensagem, { val: cj.toFixed(1) }) };
}

function at08(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'AT-08'); if (!c) return null;
  const th = c.threshold1 ?? 0.15;
  const cf    = ctx.ind('ciclo_financeiro');
  const cfAnt = ctx.indAnt('ciclo_financeiro');
  if (cf === null || cfAnt === null || cfAnt.isZero()) return null;
  if (!cf.greaterThan(cfAnt.mul(1 + th))) return null;
  return { codigoRegra: 'AT-08', severidade: c.severidade as Severidade, indicador: 'ciclo_financeiro',
    valorAtual: cf, categoria: 'eficiência operacional', regraOk: fonteOk(ctx, 'ciclo_financeiro'),
    mensagem: renderMsg(c.templateMensagem, { val: cf.toFixed(0), valAnt: cfAnt.toFixed(0) }) };
}

function at09(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'AT-09'); if (!c) return null;
  const th = c.threshold1 ?? 2;
  const ebpl = ctx.ind('endiv_bancario_pl');
  if (ebpl === null || !ebpl.greaterThan(th)) return null;
  return { codigoRegra: 'AT-09', severidade: c.severidade as Severidade, indicador: 'endiv_bancario_pl',
    valorAtual: ebpl, categoria: 'endividamento', regraOk: fonteOk(ctx, 'endiv_bancario_pl'),
    mensagem: renderMsg(c.templateMensagem, { val: rat(ebpl) }) };
}

function cr09(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'CR-09'); if (!c) return null;
  const th     = c.threshold1 ?? 1.0;
  const imobPl = ctx.ind('imobilizacao_pl');
  // imobilizacao_pl já é null quando PL ≤ 0 (calculado em P03)
  if (imobPl === null || !imobPl.greaterThan(th)) return null;
  return { codigoRegra: 'CR-09', severidade: c.severidade as Severidade, indicador: 'imobilizacao_pl',
    valorAtual: imobPl, categoria: 'imobilização', regraOk: fonteOk(ctx, 'imobilizacao_pl'),
    mensagem: renderMsg(c.templateMensagem, { val: rat(imobPl), th1: String(th) }) };
}

// ─── Regras ATENÇÃO (novas) ───────────────────────────────────────────────────

function at10(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'AT-10'); if (!c) return null;
  const t = ctx.ind('saldo_tesouraria');
  if (t === null || !t.isNegative()) return null;
  return { codigoRegra: 'AT-10', severidade: c.severidade as Severidade, indicador: 'saldo_tesouraria',
    valorAtual: t, categoria: 'capital de giro', regraOk: fonteOk(ctx, 'saldo_tesouraria'),
    mensagem: renderMsg(c.templateMensagem, { val: t.toFixed(2) }) };
}

function at11(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c   = cfg(map, 'AT-11'); if (!c) return null;
  const th  = c.threshold1 ?? 0.05;   // 5 pp de queda
  const mb  = ctx.ind('margem_bruta');
  const mbA = ctx.indAnt('margem_bruta');
  if (mb === null || mbA === null) return null;
  const queda = mbA.minus(mb);        // positivo quando a margem caiu
  if (!queda.greaterThan(th)) return null;
  return { codigoRegra: 'AT-11', severidade: c.severidade as Severidade, indicador: 'margem_bruta',
    valorAtual: mb, categoria: 'rentabilidade', regraOk: fonteOk(ctx, 'margem_bruta'),
    mensagem: renderMsg(c.templateMensagem, { val: pct(queda), mb: pct(mb) }) };
}

function at12(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c  = cfg(map, 'AT-12'); if (!c) return null;
  const th = c.threshold1 ?? 90;
  const pm = ctx.ind('pm_tributos');
  if (pm === null || !pm.greaterThan(th)) return null;
  return { codigoRegra: 'AT-12', severidade: c.severidade as Severidade, indicador: 'pm_tributos',
    valorAtual: pm, categoria: 'risco fiscal', regraOk: fonteOk(ctx, 'pm_tributos'),
    mensagem: renderMsg(c.templateMensagem, { val: pm.toFixed(0), th1: String(th) }) };
}

// ─── Regras POSITIVAS ─────────────────────────────────────────────────────────

function po01(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'PO-01'); if (!c) return null;
  const minConsec = c.threshold1 ?? 3;
  const serie = ctx.serie('ebitda');
  let count = 0;
  for (let i = serie.length - 1; i >= 1; i--) {
    const atual = serie[i];
    const ant   = serie[i - 1];
    if (atual !== null && ant !== null && atual.greaterThan(ant)) count++;
    else break;
  }
  if (count < minConsec) return null;
  const ebitda = ctx.ind('ebitda');
  return { codigoRegra: 'PO-01', severidade: c.severidade as Severidade, indicador: 'ebitda',
    valorAtual: ebitda, categoria: 'geração de caixa', regraOk: fonteOk(ctx, 'ebitda'),
    mensagem: renderMsg(c.templateMensagem, { n: String(count) }) };
}

function po02(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'PO-02'); if (!c) return null;
  const cd = ctx.ind('crescimento_divida');
  if (cd === null || !cd.isNegative()) return null;
  return { codigoRegra: 'PO-02', severidade: c.severidade as Severidade, indicador: 'crescimento_divida',
    valorAtual: cd, categoria: 'estrutura de capital', regraOk: fonteOk(ctx, 'crescimento_divida'),
    mensagem: renderMsg(c.templateMensagem, { val: pct(cd), valAbs: pct(cd.abs()) }) };
}

function po03(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'PO-03'); if (!c) return null;
  const th = c.threshold1 ?? 0.15;
  const mE = ctx.ind('margem_ebitda');
  if (mE === null || !mE.greaterThan(th)) return null;
  return { codigoRegra: 'PO-03', severidade: c.severidade as Severidade, indicador: 'margem_ebitda',
    valorAtual: mE, categoria: 'rentabilidade', regraOk: fonteOk(ctx, 'margem_ebitda'),
    mensagem: renderMsg(c.templateMensagem, { val: pct(mE), th1pct: `${(th * 100).toFixed(0)}%` }) };
}

function po04(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'PO-04'); if (!c) return null;
  const th = c.threshold1 ?? 1.5;
  const dlE = ctx.ind('dl_ebitda');
  if (dlE === null || !dlE.lessThan(th)) return null;
  return { codigoRegra: 'PO-04', severidade: c.severidade as Severidade, indicador: 'dl_ebitda',
    valorAtual: dlE, categoria: 'endividamento', regraOk: fonteOk(ctx, 'dl_ebitda'),
    mensagem: renderMsg(c.templateMensagem, { val: dlE.toFixed(1) }) };
}

function po05(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'PO-05'); if (!c) return null;
  const th = c.threshold1 ?? 0.50;
  const indep = ctx.ind('independencia_financeira');
  if (indep === null || !indep.greaterThan(th)) return null;
  return { codigoRegra: 'PO-05', severidade: c.severidade as Severidade, indicador: 'independencia_financeira',
    valorAtual: indep, categoria: 'estrutura de capital', regraOk: fonteOk(ctx, 'independencia_financeira'),
    mensagem: renderMsg(c.templateMensagem, { val: pct(indep) }) };
}

function po06(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'PO-06'); if (!c) return null;
  const th = c.threshold1 ?? 3;
  const cj = ctx.ind('cobertura_juros');
  if (cj === null || !cj.greaterThan(th)) return null;
  return { codigoRegra: 'PO-06', severidade: c.severidade as Severidade, indicador: 'cobertura_juros',
    valorAtual: cj, categoria: 'capacidade de pagamento', regraOk: fonteOk(ctx, 'cobertura_juros'),
    mensagem: renderMsg(c.templateMensagem, { val: cj.toFixed(1) }) };
}

function po07(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'PO-07'); if (!c) return null;
  const cf    = ctx.ind('ciclo_financeiro');
  const cfAnt = ctx.indAnt('ciclo_financeiro');
  if (cf === null || cfAnt === null || !cf.lessThan(cfAnt)) return null;
  return { codigoRegra: 'PO-07', severidade: c.severidade as Severidade, indicador: 'ciclo_financeiro',
    valorAtual: cf, categoria: 'eficiência operacional', regraOk: fonteOk(ctx, 'ciclo_financeiro'),
    mensagem: renderMsg(c.templateMensagem, { val: cf.toFixed(0), valAnt: cfAnt.toFixed(0) }) };
}

function po08(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c   = cfg(map, 'PO-08'); if (!c) return null;
  const th  = c.threshold1 ?? 0.15;
  const cpl = ctx.ind('crescimento_pl');
  const pl  = ctx.ind('pl');
  // PL deve ser positivo: com PL negativo, crescimento_pl positivo indica piora (ex: −55.9K→−64.9K),
  // não fortalecimento do capital próprio.
  if (cpl === null || pl === null || !pl.greaterThan(0)) return null;
  if (!cpl.greaterThan(th)) return null;
  return { codigoRegra: 'PO-08', severidade: c.severidade as Severidade, indicador: 'crescimento_pl',
    valorAtual: cpl, categoria: 'solvência', regraOk: fonteOk(ctx, 'crescimento_pl'),
    mensagem: renderMsg(c.templateMensagem, { val: pct(cpl) }) };
}

function po09(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c = cfg(map, 'PO-09'); if (!c) return null;
  const t = ctx.ind('saldo_tesouraria');
  if (t === null || !t.greaterThan(0)) return null;
  return { codigoRegra: 'PO-09', severidade: c.severidade as Severidade, indicador: 'saldo_tesouraria',
    valorAtual: t, categoria: 'capital de giro', regraOk: fonteOk(ctx, 'saldo_tesouraria'),
    mensagem: renderMsg(c.templateMensagem, { val: t.toFixed(2) }) };
}

function po10(ctx: RegraCtx, map: ConfigMap): AlertaRow | null {
  const c  = cfg(map, 'PO-10'); if (!c) return null;
  const th = c.threshold1 ?? 0.30;
  const mb = ctx.ind('margem_bruta');
  if (mb === null || !mb.greaterThan(th)) return null;
  return { codigoRegra: 'PO-10', severidade: c.severidade as Severidade, indicador: 'margem_bruta',
    valorAtual: mb, categoria: 'rentabilidade', regraOk: fonteOk(ctx, 'margem_bruta'),
    mensagem: renderMsg(c.templateMensagem, { val: pct(mb), th1pct: `${(th * 100).toFixed(0)}%` }) };
}

// ─── Avaliador principal ──────────────────────────────────────────────────────

export function avaliarRegras(ctx: RegraCtx, configMap: ConfigMap): AlertaRow[] {
  const fns = [
    cr01, cr02, cr03, cr04, cr05, cr06, cr07, cr08, cr09,
    at01, at02, at03, at04, at05, at06, at07, at08, at09, at10, at11, at12,
    po01, po02, po03, po04, po05, po06, po07, po08, po09, po10,
  ];
  return fns.map(fn => fn(ctx, configMap)).filter((a): a is AlertaRow => a !== null);
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
  alertas:      AlertaRow[],
  percInferido: number,
): { classificacao: ClassificacaoResult; confiabilidade: string } {
  const criticos  = alertas.filter(a => a.severidade === 'critico').map(a => a.codigoRegra);
  const atencao   = alertas.filter(a => a.severidade === 'atencao');
  const nc = criticos.length;
  const na = atencao.length;

  let cls: Classificacao;
  if (nc >= 3)                  cls = 'ALTO';
  else if (nc >= 1 && na >= 3)  cls = 'ALTO';
  else if (nc === 2)            cls = 'MEDIO_ALTO';
  else if (nc === 1 && na >= 1) cls = 'MEDIO_ALTO';
  else if (nc === 1)            cls = 'MEDIO';
  else if (na >= 4)             cls = 'MEDIO';
  else if (na >= 2)             cls = 'MEDIO_BAIXO';
  else                          cls = 'BAIXO';

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
    percInferido === 0   ? 'alta'  :
    percInferido <= 0.20 ? 'media' : 'baixa';

  return {
    classificacao: { classificacao: cls, classificacaoNum: CLASS_NUM[cls], overrideAplicado: override, motivoOverride },
    confiabilidade,
  };
}
