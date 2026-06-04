'use client';

import React, { useMemo } from 'react';
import { ArrowUpIcon, ArrowDownIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { Indicador, Alerta, ResumoFinanceiro } from '@/lib/analise-credito-api';

/* ─── Helpers de formatação ──────────────────────────────────────────────── */

function fmtBrl(v: string | number | null | undefined): string {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  if (Math.abs(n) >= 1e9) return `R$ ${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `R$ ${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `R$ ${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtPct(v: string | null | undefined): string {
  if (v == null) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function fmtRatio(v: string | null | undefined): string {
  if (v == null) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return `${n.toFixed(2)}x`;
}

function fmtDias(v: string | null | undefined): string {
  if (v == null) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  return `${n.toFixed(0)} dias`;
}

function calcTrend(curr: string | null | undefined, prev: string | null | undefined): number | null {
  const c = Number(curr);
  const p = Number(prev);
  if (!curr || !prev || Number.isNaN(c) || Number.isNaN(p) || p === 0) return null;
  return ((c - p) / Math.abs(p)) * 100;
}

/* ─── Badge semântico por indicador ─────────────────────────────────────── */

const BADGE_LABELS: Record<string, { positivo: string; atencao: string; critico: string }> = {
  liquidez_corrente: { positivo: 'adequada',  atencao: 'atenção',   critico: 'baixa'    },
  liquidez_seca:     { positivo: 'adequada',  atencao: 'atenção',   critico: 'baixa'    },
  liquidez_imediata: { positivo: 'adequada',  atencao: 'atenção',   critico: 'baixa'    },
  margem_ebitda:     { positivo: 'saudável',  atencao: 'monitorar', critico: 'crítica'  },
  margem_liquida:    { positivo: 'saudável',  atencao: 'monitorar', critico: 'negativa' },
  roe:               { positivo: 'forte',     atencao: 'moderado',  critico: 'baixo'    },
  roa:               { positivo: 'adequado',  atencao: 'monitorar', critico: 'baixo'    },
  roic:              { positivo: 'adequado',  atencao: 'monitorar', critico: 'baixo'    },
  dl_ebitda:         { positivo: 'adequado',  atencao: 'moderado',  critico: 'alto'     },
  cobertura_juros:   { positivo: 'adequado',  atencao: 'atenção',   critico: 'baixa'    },
  ciclo_financeiro:  { positivo: 'saudável',  atencao: 'monitorar', critico: 'elevado'  },
  alavancagem:       { positivo: 'adequada',  atencao: 'moderada',  critico: 'alta'     },
};

const SEV_CLS: Record<string, string> = {
  positivo: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  atencao:  'bg-amber-50   text-amber-700   border-amber-300',
  critico:  'bg-red-50     text-red-700     border-red-300',
};

function SemanticBadge({ indicador, severidade }: Readonly<{ indicador: string; severidade?: string }>) {
  if (!severidade) return null;
  const mapa  = BADGE_LABELS[indicador];
  const label = mapa?.[severidade as keyof typeof mapa] ?? severidade;
  const cls   = SEV_CLS[severidade] ?? SEV_CLS.atencao;
  return (
    <span className={cn('inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium leading-tight', cls)}>
      {label}
    </span>
  );
}

/* ─── Seta de tendência ──────────────────────────────────────────────────── */

function Trend({ pct, vsLabel }: Readonly<{ pct: number | null; vsLabel?: string }>) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span className={cn('flex items-center gap-0.5 text-[11px] font-medium',
      up ? 'text-emerald-600' : 'text-red-600')}>
      {up ? <ArrowUpIcon size={9} weight="bold" /> : <ArrowDownIcon size={9} weight="bold" />}
      {up ? '+' : ''}{pct.toFixed(1)}%{vsLabel ? ` ${vsLabel}` : ''}
    </span>
  );
}

/* ─── KPI Card ───────────────────────────────────────────────────────────── */

function KpiCard({
  label, valor, sub, trend, vsLabel, badgeInd, badgeSev,
}: Readonly<{
  label:     string;
  valor:     string;
  sub?:      string;
  trend?:    number | null;
  vsLabel?:  string;
  badgeInd?: string;
  badgeSev?: string;
}>) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-[22px] font-bold text-foreground tabular-nums leading-tight">{valor}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      {trend !== undefined && <Trend pct={trend ?? null} vsLabel={vsLabel} />}
      {badgeInd && badgeSev && (
        <div><SemanticBadge indicador={badgeInd} severidade={badgeSev} /></div>
      )}
    </div>
  );
}

/* ─── Composição do ativo ────────────────────────────────────────────────── */

const BAR_CORES = [
  'bg-emerald-500',
  'bg-blue-500',
  'bg-amber-500',
  'bg-gray-400',
  'bg-violet-400',
];

interface BarItem { label: string; valor: number; cor: string; alertar?: boolean }

function ComposicaoAtivo({ items, total }: Readonly<{ items: BarItem[]; total: number }>) {
  if (total === 0 || items.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Composição do ativo
      </p>
      <div className="space-y-3">
        {items.map(item => {
          const pct = (item.valor / total) * 100;
          return (
            <div key={item.label} className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">{item.label}</span>
              <div className="flex-1 h-2 rounded-full bg-muted">
                {/* eslint-disable-next-line react/forbid-dom-props -- largura dinâmica de dados */}
                <div
                  className={cn('h-full rounded-full transition-all', item.cor)}
                  style={{ width: `${Math.min(pct, 100).toFixed(1)}%` }}
                />
              </div>
              <div className="flex w-14 shrink-0 items-center justify-end gap-1">
                <span className={cn('text-xs font-semibold tabular-nums',
                  item.alertar ? 'text-red-600' : 'text-foreground')}>
                  {pct.toFixed(0)}%
                </span>
                {item.alertar && (
                  <WarningCircleIcon size={12} className="shrink-0 text-red-500" weight="fill" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Lista de indicadores ───────────────────────────────────────────────── */

const IND_LISTA: { key: string; label: string; fmt: (v: string | null) => string }[] = [
  { key: 'liquidez_corrente', label: 'Liquidez corrente',  fmt: fmtRatio },
  { key: 'liquidez_seca',     label: 'Liquidez seca',      fmt: fmtRatio },
  { key: 'liquidez_imediata', label: 'Liquidez imediata',  fmt: fmtRatio },
  { key: 'margem_ebitda',     label: 'Margem EBITDA',      fmt: fmtPct   },
  { key: 'margem_liquida',    label: 'Margem líquida',     fmt: fmtPct   },
  { key: 'roe',               label: 'ROE',                fmt: fmtPct   },
  { key: 'roa',               label: 'ROA',                fmt: fmtPct   },
  { key: 'roic',              label: 'ROIC',               fmt: fmtPct   },
  { key: 'ciclo_financeiro',  label: 'Ciclo financeiro',   fmt: fmtDias  },
  { key: 'dl_ebitda',         label: 'DL / EBITDA',        fmt: fmtRatio },
  { key: 'cobertura_juros',   label: 'Cobertura de juros', fmt: fmtRatio },
];

/* ─── Componente principal ───────────────────────────────────────────────── */

export interface VisaoGeralProps {
  exercicio:          number;
  indicadores:        Indicador[];
  alertas:            Alerta[];
  financeiro:         ResumoFinanceiro | null;
  financeiroPrevio?:  ResumoFinanceiro | null;
}

export function VisaoGeral({
  exercicio, indicadores, alertas, financeiro, financeiroPrevio,
}: Readonly<VisaoGeralProps>) {
  const alertaMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of alertas.filter(a => a.exercicio === exercicio)) {
      if (!m.has(a.indicador) || a.severidade === 'critico') m.set(a.indicador, a.severidade);
    }
    return m;
  }, [alertas, exercicio]);

  const ind = (nome: string) =>
    indicadores.find(i => i.indicador === nome && i.exercicio === exercicio);
  const sev = (nome: string) => alertaMap.get(nome);

  const criticos  = alertas.filter(a => a.exercicio === exercicio && a.severidade === 'critico').length;
  const atencao_  = alertas.filter(a => a.exercicio === exercicio && a.severidade === 'atencao').length;
  const positivos = alertas.filter(a => a.exercicio === exercicio && a.severidade === 'positivo').length;

  const dre  = financeiro?.dre     ?? {};
  const dreP = financeiroPrevio?.dre ?? {};
  const ec   = financeiro?.estrutura;
  const ecP  = financeiroPrevio?.estrutura;

  const vsLabel = financeiroPrevio ? `vs ${financeiroPrevio.exercicio}` : undefined;

  // Composição do ativo — será enriquecida com fórmulas
  const caixaVal   = Number(ind('caixa_equiv')?.valor ?? 0);
  const ativoTotal = Number(ec?.ativoTotal ?? 0);

  const barItems: BarItem[] = (ativoTotal > 0 ? [
    { label: 'Caixa',  valor: caixaVal,                           cor: BAR_CORES[0] },
    { label: 'Outros', valor: Math.max(0, ativoTotal - caixaVal), cor: BAR_CORES[3] },
  ] : []).filter(b => b.valor > 0);

  return (
    <div className="flex flex-col gap-4">

      {/* ── Resumo de alertas ── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
          <div>
            <p className="text-xs text-red-600">Alertas críticos</p>
            <p className="text-3xl font-bold tabular-nums text-red-700">{criticos}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
          <div>
            <p className="text-xs text-amber-600">Pontos de atenção</p>
            <p className="text-3xl font-bold tabular-nums text-amber-700">{atencao_}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
          <div>
            <p className="text-xs text-emerald-600">Indicadores positivos</p>
            <p className="text-3xl font-bold tabular-nums text-emerald-700">{positivos}</p>
          </div>
        </div>
      </div>

      {/* ── KPIs linha 1: resultados ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Receita líquida"
          valor={fmtBrl(dre['receita_liquida'])}
          trend={calcTrend(dre['receita_liquida'], dreP['receita_liquida'])}
          vsLabel={vsLabel}
        />
        <KpiCard
          label="EBITDA"
          valor={fmtBrl(dre['ebitda'])}
          sub={ind('margem_ebitda') ? `Margem ${fmtPct(ind('margem_ebitda')?.valor)}` : undefined}
          badgeInd="margem_ebitda"
          badgeSev={sev('margem_ebitda')}
        />
        <KpiCard
          label="Lucro líquido"
          valor={fmtBrl(dre['lucro_liquido'])}
          sub={ind('margem_liquida') ? `Margem ${fmtPct(ind('margem_liquida')?.valor)}` : undefined}
          badgeInd="margem_liquida"
          badgeSev={sev('margem_liquida')}
        />
        <KpiCard
          label="Patrimônio líquido"
          valor={fmtBrl(ec?.pl)}
          trend={calcTrend(ec?.pl, ecP?.pl)}
          vsLabel={vsLabel}
          badgeInd="roe"
          badgeSev={sev('roe')}
        />
      </div>

      {/* ── KPIs linha 2: dívida e liquidez ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Dívida financeira"
          valor={fmtBrl(ec?.dividaFinanceiraTot)}
          sub={ec ? `CP ${fmtBrl(ec.dividaFinanceiraCp)} · LP ${fmtBrl(ec.dividaFinanceiraLp)}` : undefined}
        />
        <KpiCard
          label="Dívida líquida / EBITDA"
          valor={fmtRatio(ind('dl_ebitda')?.valor)}
          badgeInd="dl_ebitda"
          badgeSev={sev('dl_ebitda')}
        />
        <KpiCard
          label="Liquidez corrente"
          valor={fmtRatio(ind('liquidez_corrente')?.valor)}
          badgeInd="liquidez_corrente"
          badgeSev={sev('liquidez_corrente')}
        />
        <KpiCard
          label="Cobertura de juros"
          valor={fmtRatio(ind('cobertura_juros')?.valor)}
          badgeInd="cobertura_juros"
          badgeSev={sev('cobertura_juros')}
        />
      </div>

      {/* ── Composição do ativo ── */}
      <ComposicaoAtivo items={barItems} total={ativoTotal} />

      {/* ── Indicadores de liquidez e rentabilidade ── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <p className="px-4 pt-4 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Indicadores de liquidez e rentabilidade
        </p>
        {IND_LISTA.map(({ key, label, fmt }) => {
          const item = ind(key);
          if (!item) return null;
          return (
            <div
              key={key}
              className="flex items-center justify-between border-t border-border px-4 py-2.5 hover:bg-muted/30"
            >
              <span className="text-sm text-foreground">{label}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {fmt(item.valor)}
                </span>
                <SemanticBadge indicador={key} severidade={sev(key)} />
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}
