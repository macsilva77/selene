'use client';

import React, { useMemo } from 'react';
import { ArrowUpIcon, ArrowDownIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { Indicador, ResumoFinanceiro, KpiAnual } from '@/lib/analise-credito-api';

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

const toN = (v: string | null | undefined): number => {
  const x = Number(v ?? 0);
  return Number.isNaN(x) ? 0 : x;
};

const fmtN = (v: number, dec = 2): string =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });

function fmtBrl(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `R$ ${fmtN(v / 1e9, 1)}B`;
  if (abs >= 1e6) return `R$ ${fmtN(v / 1e6, 1)}M`;
  if (abs >= 1e3) return `R$ ${fmtN(v / 1e3, 1)}K`;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const fmtPct   = (v: number, dec = 1): string => `${fmtN(v * 100, dec)}%`;
const fmtRatio = (v: number, dec = 2): string => `${fmtN(v, dec)}x`;

/* ─── Severity ────────────────────────────────────────────────────────────── */

type Sev = 'positivo' | 'atencao' | 'critico';

const SEV_BADGE: Record<Sev, string> = {
  positivo: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  atencao:  'bg-amber-50   text-amber-700   border-amber-300',
  critico:  'bg-red-50     text-red-700     border-red-300',
};
const SEV_TXT: Record<Sev, string> = {
  positivo: 'text-emerald-700',
  atencao:  'text-amber-700',
  critico:  'text-red-700',
};

const sevGrauEndiv = (v: number): Sev => v <= 0.45 ? 'positivo' : v <= 0.65 ? 'atencao' : 'critico';
const sevIndepFin  = (v: number): Sev => v < 0 ? 'critico' : v >= 0.4  ? 'positivo' : v >= 0.25 ? 'atencao' : 'critico';
const sevCtCp      = (v: number): Sev => v < 0 ? 'critico' : v <= 1.5  ? 'positivo' : v <= 3.0  ? 'atencao' : 'critico';
const sevEndivBanc = (v: number): Sev => v <= 1.0  ? 'positivo' : v <= 2.0  ? 'atencao' : 'critico';
const sevCobertura = (v: number): Sev => v >= 3.0  ? 'positivo' : v >= 1.5  ? 'atencao' : 'critico';
const sevDividaCp  = (v: number): Sev => v <= 0.4  ? 'positivo' : v <= 0.6  ? 'atencao' : 'critico';

/* ─── Badge ───────────────────────────────────────────────────────────────── */

function Badge({ label, sev }: Readonly<{ label: string; sev: Sev }>) {
  return (
    <span className={cn('inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium leading-tight', SEV_BADGE[sev])}>
      {label}
    </span>
  );
}

/* ─── KPI card ────────────────────────────────────────────────────────────── */

function MetricCard({ label, valor, badge }: Readonly<{
  label: string;
  valor: string;
  badge: { label: string; sev: Sev };
}>) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-[22px] font-bold text-foreground tabular-nums leading-tight">{valor}</p>
      <div><Badge label={badge.label} sev={badge.sev} /></div>
    </div>
  );
}

/* ─── Stacked bar ─────────────────────────────────────────────────────────── */

interface Seg { pct: number; bgCls: string; dotCls: string; label: string; valor: number }

function StackedBar({ titulo, total, segs, alerta, alertSev = 'atencao' }: Readonly<{
  titulo:    string;
  total:     number;
  segs:      Seg[];
  alerta?:   string;
  alertSev?: Sev;
}>) {
  const alertCls =
    alertSev === 'critico'  ? 'border-red-200 bg-red-50 text-red-800' :
    alertSev === 'positivo' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' :
                              'border-amber-200 bg-amber-50 text-amber-800';
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sm font-semibold text-foreground">{titulo} — {fmtBrl(total)}</p>
      <div className="flex h-5 w-full overflow-hidden rounded-full">
        {segs.map((s, i) => (
          <div key={i} className={s.bgCls} style={{ width: `${(s.pct * 100).toFixed(2)}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {segs.map((s, i) => (
          <span key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', s.dotCls)} />
            {s.label} — {fmtPct(s.pct)} · {fmtBrl(s.valor)}
          </span>
        ))}
      </div>
      {alerta && (
        <div className={cn('rounded-md border px-3 py-2 text-xs', alertCls)}>{alerta}</div>
      )}
    </div>
  );
}

/* ─── Evolution table ─────────────────────────────────────────────────────── */

interface EvolEntry { fmt: string; raw: number; sev: Sev }
interface EvolRow   { label: string; upIsGood: boolean; byYear: Map<number, EvolEntry> }

function EvolTable({ rows, years, alerta, alertSev = 'positivo' }: Readonly<{
  rows:      EvolRow[];
  years:     number[];
  alerta?:   string;
  alertSev?: Sev;
}>) {
  const alertCls =
    alertSev === 'critico'  ? 'border-red-200 bg-red-50 text-red-800' :
    alertSev === 'positivo' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' :
                              'border-amber-200 bg-amber-50 text-amber-800';
  const cols = years.length;
  const gtc  = `1fr repeat(${cols}, 80px)`;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-semibold text-foreground">
        Evolução da estrutura de capital ({cols} {cols === 1 ? 'ano' : 'anos'})
      </p>
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="grid border-b border-border bg-muted/40 px-4 py-2.5" style={{ gridTemplateColumns: gtc }}>
          <span className="text-xs font-semibold text-muted-foreground">Indicador</span>
          {years.map(y => (
            <span key={y} className="text-right text-xs font-semibold text-muted-foreground">{y}</span>
          ))}
        </div>
        {rows.map((row, ri) => (
          <div
            key={ri}
            className="grid border-t border-border px-4 py-2.5 hover:bg-muted/30"
            style={{ gridTemplateColumns: gtc }}
          >
            <span className="text-sm text-foreground">{row.label}</span>
            {years.map((y, yi) => {
              const entry   = row.byYear.get(y);
              const prev    = yi > 0 ? row.byYear.get(years[yi - 1]) : null;
              const isLast  = yi === cols - 1;
              const trendUp = isLast && entry && prev ? entry.raw > prev.raw : null;
              const isGood  = trendUp !== null ? (row.upIsGood ? trendUp : !trendUp) : null;
              const txtCls  = isLast && entry ? SEV_TXT[entry.sev] : '';
              return (
                <div key={y} className="flex items-center justify-end gap-0.5">
                  <span className={cn('text-sm tabular-nums', isLast && 'font-semibold', isLast && txtCls)}>
                    {entry?.fmt ?? '—'}
                  </span>
                  {isLast && trendUp !== null && isGood !== null && (
                    trendUp
                      ? <ArrowUpIcon   size={10} weight="bold" className={isGood ? 'text-emerald-600' : 'text-red-600'} />
                      : <ArrowDownIcon size={10} weight="bold" className={isGood ? 'text-emerald-600' : 'text-red-600'} />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {alerta && (
        <div className={cn('rounded-md border px-3 py-2 text-xs', alertCls)}>{alerta}</div>
      )}
    </div>
  );
}

/* ─── Main ────────────────────────────────────────────────────────────────── */

export interface EstruturaCapitalProps {
  exercicio:   number;
  financeiro:  ResumoFinanceiro | null;
  indicadores: Indicador[];
  kpisAnuais:  KpiAnual[];
}

export function EstruturaCapital({
  exercicio, financeiro, indicadores, kpisAnuais,
}: Readonly<EstruturaCapitalProps>) {
  const ec = financeiro?.estrutura;

  const ativoTotal   = toN(ec?.ativoTotal);
  const pl           = toN(ec?.pl);
  const passivoTotal = ec?.passivoTotal
    ? toN(ec.passivoTotal)
    : ativoTotal > 0 ? Math.max(0, ativoTotal - pl) : 0;
  const dfCp  = toN(ec?.dividaFinanceiraCp);
  const dfLp  = toN(ec?.dividaFinanceiraLp);
  const dfTot = toN(ec?.dividaFinanceiraTot);

  const grauEndiv  = ativoTotal > 0 ? passivoTotal / ativoTotal : 0;
  const indepFin   = ativoTotal > 0 ? pl / ativoTotal : 0;
  const relCtCp    = pl > 0 ? passivoTotal / pl : 0;
  const endivBanc  = pl > 0 ? dfTot / pl : 0;
  const dividaCpPt = dfTot > 0 ? dfCp / dfTot : 0;

  const cobRaw = toN(
    indicadores.find(i => i.indicador === 'cobertura_juros' && i.exercicio === exercicio)?.valor,
  );

  /* ── Evolução multi-year ── */
  const sorted = useMemo(
    () => [...kpisAnuais].sort((a, b) => a.exercicio - b.exercicio),
    [kpisAnuais],
  );

  const evolYears = sorted.map(k => k.exercicio);

  const endivBancByYear = useMemo(() => {
    const m = new Map<number, EvolEntry>();
    for (const k of sorted) {
      const df = toN(k.dividaFinanceira);
      const p  = toN(k.pl);
      const v  = p > 0 ? df / p : 0;
      m.set(k.exercicio, { fmt: fmtRatio(v), raw: v, sev: sevEndivBanc(v) });
    }
    return m;
  }, [sorted]);

  const coberturaByYear = useMemo(() => {
    const m = new Map<number, EvolEntry>();
    for (const k of sorted) {
      const ind = indicadores.find(i => i.indicador === 'cobertura_juros' && i.exercicio === k.exercicio);
      if (ind?.valor) {
        const v = toN(ind.valor);
        m.set(k.exercicio, { fmt: fmtRatio(v, 1), raw: v, sev: sevCobertura(v) });
      }
    }
    return m;
  }, [sorted, indicadores]);

  const dlEbitdaByYear = useMemo(() => {
    const m = new Map<number, EvolEntry>();
    for (const k of sorted) {
      const ind = indicadores.find(i => i.indicador === 'dl_ebitda' && i.exercicio === k.exercicio);
      if (ind?.valor) {
        const v = toN(ind.valor);
        const sev: Sev = v <= 2 ? 'positivo' : v <= 4 ? 'atencao' : 'critico';
        m.set(k.exercicio, { fmt: fmtRatio(v, 1), raw: v, sev });
      }
    }
    return m;
  }, [sorted, indicadores]);

  const evolRows: EvolRow[] = [];
  if (endivBancByYear.size > 0)
    evolRows.push({ label: 'Endividamento bancário / PL', upIsGood: false, byYear: endivBancByYear });
  if (coberturaByYear.size > 0)
    evolRows.push({ label: 'Cobertura de juros', upIsGood: true, byYear: coberturaByYear });
  if (dlEbitdaByYear.size > 0)
    evolRows.push({ label: 'DL / EBITDA', upIsGood: false, byYear: dlEbitdaByYear });

  /* ── Alert texts ── */
  const alertFinSev: Sev = grauEndiv > 0.65 ? 'critico' : grauEndiv > 0.45 ? 'atencao' : 'positivo';
  const alertFin = (() => {
    const pct = fmtPct(grauEndiv);
    if (grauEndiv > 0.65) return `Capital de terceiros financia ${pct} dos ativos. Alavancagem alta.`;
    if (grauEndiv > 0.45) return `Capital de terceiros financia ${pct} dos ativos. Alavancagem moderada-alta.`;
    return `Capital de terceiros financia ${pct} dos ativos. Estrutura equilibrada.`;
  })();

  const alertDivSev: Sev = dividaCpPt > 0.6 ? 'critico' : dividaCpPt > 0.4 ? 'atencao' : 'positivo';
  const alertDiv = dfTot > 0 ? (() => {
    const pct = fmtPct(dividaCpPt, 0);
    if (dividaCpPt > 0.6) return `${pct} da dívida vence em menos de 12 meses. Pressão relevante sobre o caixa no curto prazo.`;
    if (dividaCpPt > 0.4) return `${pct} da dívida vence em curto prazo. Monitorar refinanciamentos.`;
    return `Perfil de vencimento equilibrado: ${pct} em curto prazo.`;
  })() : undefined;

  const evolVals = [...endivBancByYear.values()];
  const evolFirst = evolVals[0];
  const evolLast  = evolVals.at(-1);
  const alertEvolSev: Sev =
    evolFirst && evolLast && evolFirst !== evolLast
      ? evolLast.raw < evolFirst.raw ? 'positivo'
      : evolLast.raw > evolFirst.raw * 1.1 ? 'critico'
      : 'atencao'
      : 'atencao';
  const alertEvol =
    evolFirst && evolLast && evolFirst !== evolLast
      ? evolLast.raw < evolFirst.raw
        ? 'Tendência de desalavancagem consistente nos últimos exercícios. Sinal positivo.'
        : evolLast.raw > evolFirst.raw * 1.1
          ? 'Alavancagem em crescimento nos últimos exercícios. Requer atenção.'
          : 'Nível de alavancagem estável no período.'
      : undefined;

  if (!ec) {
    return (
      <p className="text-sm text-muted-foreground">
        Dados de estrutura de capital não disponíveis. Execute o processamento da empresa.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">

      {/* ── Financiamento do ativo total ── */}
      <StackedBar
        titulo="Financiamento do ativo total"
        total={ativoTotal}
        segs={[
          {
            pct:    Math.max(0, indepFin),
            bgCls:  'bg-emerald-500',
            dotCls: 'bg-emerald-500',
            label:  indepFin < 0 ? 'Patrimônio Líquido (negativo)' : 'Capital próprio (PL)',
            valor:  pl,
          },
          { pct: indepFin < 0 ? 1 : 1 - indepFin, bgCls: 'bg-red-500', dotCls: 'bg-red-500', label: 'Capital de terceiros', valor: passivoTotal },
        ]}
        alerta={indepFin < 0
          ? `Patrimônio Líquido negativo. Passivos financiam ${fmtPct(grauEndiv)} dos ativos — empresa tecnicamente insolvente.`
          : alertFin}
        alertSev={indepFin < 0 ? 'critico' : alertFinSev}
      />

      {/* ── 6 KPI cards ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard
          label="Grau de endividamento"
          valor={fmtN(grauEndiv, 2)}
          badge={{
            label: grauEndiv <= 0.45 ? 'baixo' : grauEndiv <= 0.65 ? 'moderado' : 'alto',
            sev: sevGrauEndiv(grauEndiv),
          }}
        />
        <MetricCard
          label="Independência financeira"
          valor={indepFin < 0 ? '0%' : fmtPct(indepFin)}
          badge={{
            label: indepFin < 0 ? 'PL negativo' : indepFin >= 0.4 ? 'sólida' : indepFin >= 0.25 ? 'moderada' : 'fraca',
            sev: sevIndepFin(indepFin),
          }}
        />
        <MetricCard
          label="Relação CT / CP"
          valor={pl < 0 ? '—' : fmtRatio(relCtCp)}
          badge={{
            label: pl < 0 ? 'PL negativo' : relCtCp <= 1.5 ? 'adequado' : relCtCp <= 3.0 ? 'alavancagem mod.' : 'alta alavancagem',
            sev: pl < 0 ? 'critico' : sevCtCp(relCtCp),
          }}
        />
        <MetricCard
          label="Endividamento bancário / PL"
          valor={pl < 0 ? '—' : fmtRatio(endivBanc)}
          badge={{
            label: pl < 0 ? 'PL negativo' : endivBanc <= 1.0 ? 'saudável' : endivBanc <= 2.0 ? 'monitorar' : 'elevado',
            sev: pl < 0 ? 'critico' : sevEndivBanc(endivBanc),
          }}
        />
        <MetricCard
          label="Cobertura de juros (EBIT/DF)"
          valor={cobRaw > 0 ? fmtRatio(cobRaw, 1) : '—'}
          badge={{
            label: cobRaw <= 0 ? '—' : cobRaw >= 3 ? 'adequado' : cobRaw >= 1.5 ? 'marginal' : 'insuficiente',
            sev: cobRaw > 0 ? sevCobertura(cobRaw) : 'atencao',
          }}
        />
        <MetricCard
          label="Dívida CP / dívida total"
          valor={dfTot > 0 ? fmtPct(dividaCpPt, 0) : '—'}
          badge={{
            label: dfTot <= 0 ? '—' : dividaCpPt <= 0.4 ? 'equilibrado' : dividaCpPt <= 0.6 ? 'atenção CP' : 'concentrado CP',
            sev: dfTot > 0 ? sevDividaCp(dividaCpPt) : 'atencao',
          }}
        />
      </div>

      {/* ── Perfil de vencimento da dívida ── */}
      {dfTot > 0 && (
        <StackedBar
          titulo="Perfil de vencimento da dívida"
          total={dfTot}
          segs={[
            { pct: dividaCpPt,     bgCls: 'bg-red-500',  dotCls: 'bg-red-500',  label: 'Curto prazo', valor: dfCp },
            { pct: 1 - dividaCpPt, bgCls: 'bg-blue-500', dotCls: 'bg-blue-500', label: 'Longo prazo', valor: dfLp },
          ]}
          alerta={alertDiv}
          alertSev={alertDivSev}
        />
      )}

      {/* ── Evolução ── */}
      {evolRows.length > 0 && evolYears.length > 1 && (
        <EvolTable
          rows={evolRows}
          years={evolYears}
          alerta={alertEvol}
          alertSev={alertEvolSev}
        />
      )}

    </div>
  );
}
