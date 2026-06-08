'use client';

import React, { useMemo } from 'react';
import type { KpiAnual } from '@/lib/analise-credito-api';

/* ─── Formatação ─────────────────────────────────────────────────────────── */

function fmtBrl(v: string | null | undefined): string {
  if (v == null) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `R$ ${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `R$ ${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `R$ ${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtPct(v: number | null): string {
  if (v == null) return '';
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function pct(curr: string | null, prev: string | null): number | null {
  const c = Number(curr);
  const p = Number(prev);
  if (!curr || !prev || Number.isNaN(c) || Number.isNaN(p) || p === 0) return null;
  return ((c - p) / Math.abs(p)) * 100;
}

function totalGrowth(first: string | null, last: string | null): number | null {
  return pct(last, first);
}

/* ─── Cores progressivas por KPI ─────────────────────────────────────────── */

const PALETAS: Record<string, string[]> = {
  receita: ['#BFDBFE','#93C5FD','#60A5FA','#3B82F6','#1D4ED8','#1E3A8A'],
  ebitda:  ['#BBF7D0','#86EFAC','#4ADE80','#22C55E','#15803D','#14532D'],
  pl:      ['#DDD6FE','#C4B5FD','#A78BFA','#7C3AED','#6D28D9','#4C1D95'],
  divida:  ['#FECACA','#FCA5A5','#F87171','#EF4444','#B91C1C','#7F1D1D'],
};

function corDa(paleta: string[], idx: number, total: number): string {
  const step = paleta.length > 1 ? (paleta.length - 1) / Math.max(total - 1, 1) : 0;
  const i = Math.min(Math.round(idx * step), paleta.length - 1);
  return paleta[i] ?? paleta.at(-1) ?? '#94a3b8';
}

/* ─── Rótulo de tendência ─────────────────────────────────────────────────── */

function labelTendencia(anos: KpiAnual[], key: keyof Omit<KpiAnual, 'exercicio'>): string {
  const sorted = [...anos].sort((a, b) => a.exercicio - b.exercicio);
  const first  = sorted[0]?.[key] as string | null | undefined;
  const last   = sorted[sorted.length - 1]?.[key] as string | null | undefined;
  const g      = totalGrowth(first ?? null, last ?? null);
  if (g == null) return '';
  if (Math.abs(g) < 3) return 'estável';
  if (g > 0) return `crescimento acumulado ${fmtPct(g)}`;
  return `queda acumulada ${fmtPct(g)}`;
}

function labelEbitdaTendencia(anos: KpiAnual[]): string {
  const sorted = [...anos].sort((a, b) => a.exercicio - b.exercicio);
  const margens = sorted.map(k => {
    const e = Number(k.ebitda);
    const r = Number(k.receitaLiquida);
    return r > 0 ? e / r : null;
  }).filter((m): m is number => m !== null);
  if (margens.length < 2) return '';
  const delta = (margens.at(-1) ?? 0) - (margens[0] ?? 0);
  if (Math.abs(delta) < 0.005) return 'margem estável';
  return delta > 0 ? 'margem em expansão' : 'margem em contração';
}

/* ─── Bloco de barras para um KPI ────────────────────────────────────────── */

interface KpiBarBlockProps {
  titulo:    string;
  subtitulo: string;
  anos:      KpiAnual[];
  getValue:  (k: KpiAnual) => string | null;
  getExtra?: (k: KpiAnual) => string;   // ex: margem EBITDA
  paleta:    string;
}

function KpiBarBlock({ titulo, subtitulo, anos, getValue, getExtra, paleta }: Readonly<KpiBarBlockProps>) {
  const sorted = useMemo(() => [...anos].sort((a, b) => a.exercicio - b.exercicio), [anos]);
  const cores  = PALETAS[paleta] ?? PALETAS.receita;

  const valores = sorted.map(k => Math.abs(Number(getValue(k) ?? 0)));
  const maxVal  = Math.max(...valores, 1);

  return (
    <div className="flex flex-col gap-1">
      <div className="mb-2">
        <p className="text-sm font-semibold text-foreground">{titulo}</p>
        {subtitulo && (
          <p className="text-xs text-muted-foreground">{subtitulo}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {sorted.map((k, idx) => {
          const val    = getValue(k);
          const numVal = Math.abs(Number(val ?? 0));
          const widthPct = maxVal > 0 ? (numVal / maxVal) * 100 : 0;
          const cor    = corDa(cores, idx, sorted.length);
          const prev   = sorted[idx - 1] ?? null;
          const growth = pct(val, getValue(prev));
          const extra  = getExtra?.(k);

          return (
            <div key={k.exercicio} className="flex items-center gap-2">
              {/* Ano */}
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {k.exercicio}
              </span>

              {/* Barra — width e backgroundColor dinâmicos requerem inline style */}
              <div className="flex-1 h-5 rounded-sm bg-muted/30 overflow-hidden">
                <div
                  className="h-full rounded-sm transition-all duration-500"
                  style={{ width: `${widthPct.toFixed(1)}%`, backgroundColor: cor }} // eslint-disable-line react/forbid-component-props
                />
              </div>

              {/* Valor */}
              <span className="w-20 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">
                {fmtBrl(val)}
              </span>

              {/* Extra (margem) */}
              {getExtra && (
                <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {extra}
                </span>
              )}

              {/* Variação YoY */}
              {(() => {
                let colorCls = 'text-muted-foreground';
                if (growth !== null && growth > 5)  colorCls = 'text-emerald-600';
                if (growth !== null && growth < -5) colorCls = 'text-red-600';
                if (growth !== null && Math.abs(growth) <= 5) colorCls = 'text-amber-500';
                let label = '—';
                if (idx === 0)       label = 'base';
                else if (growth !== null) label = fmtPct(growth);
                return (
                  <span className={`w-12 shrink-0 text-right text-[11px] font-medium tabular-nums ${colorCls}`}>
                    {label}
                  </span>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Componente principal ────────────────────────────────────────────────── */

export interface KpisAnuaisProps {
  kpis: KpiAnual[];
}

export function KpisAnuais({ kpis }: Readonly<KpisAnuaisProps>) {
  if (kpis.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum dado disponível.</p>;
  }

  const ebitdaMargemExtra = (k: KpiAnual): string => {
    const e = Number(k.ebitda);
    const r = Number(k.receitaLiquida);
    if (Number.isNaN(e) || Number.isNaN(r) || r === 0) return '';
    return `${((e / r) * 100).toFixed(1)}%`;
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Receita líquida */}
      <KpiBarBlock
        titulo="Receita líquida"
        subtitulo={labelTendencia(kpis, 'receitaLiquida')}
        anos={kpis}
        getValue={k => k.receitaLiquida}
        paleta="receita"
      />

      {/* EBITDA */}
      <KpiBarBlock
        titulo="EBITDA"
        subtitulo={labelEbitdaTendencia(kpis)}
        anos={kpis}
        getValue={k => k.ebitda}
        getExtra={ebitdaMargemExtra}
        paleta="ebitda"
      />

      {/* PL e Dívida lado a lado */}
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
        <KpiBarBlock
          titulo="Patrimônio líquido"
          subtitulo={labelTendencia(kpis, 'pl')}
          anos={kpis}
          getValue={k => k.pl}
          paleta="pl"
        />
        <KpiBarBlock
          titulo="Dívida financeira"
          subtitulo={labelTendencia(kpis, 'dividaFinanceira')}
          anos={kpis}
          getValue={k => k.dividaFinanceira}
          paleta="divida"
        />
      </div>
    </div>
  );
}
