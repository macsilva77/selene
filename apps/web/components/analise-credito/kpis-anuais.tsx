'use client';

import React from 'react';
import { ArrowUpIcon, ArrowDownIcon, MinusIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { KpiAnual } from '@/lib/analise-credito-api';

/* ─── Formatação ─────────────────────────────────────────────────────────── */

function fmtBrl(v: string | null | undefined): string {
  if (v == null) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  if (Math.abs(n) >= 1e9) return `R$ ${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `R$ ${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `R$ ${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/* ─── Semáforo ────────────────────────────────────────────────────────────── */

type Sinal = 'verde' | 'amarelo' | 'vermelho' | 'neutro';

function calcSinal(curr: string | null, prev: string | null, inverso = false): Sinal {
  if (curr == null || prev == null) return 'neutro';
  const c = Number(curr);
  const p = Number(prev);
  if (Number.isNaN(c) || Number.isNaN(p) || p === 0) return 'neutro';
  const pct = ((c - p) / Math.abs(p)) * 100;
  const up = inverso ? pct < -5 : pct > 5;
  const down = inverso ? pct > 5 : pct < -5;
  if (up)   return 'verde';
  if (down) return 'vermelho';
  return 'amarelo';
}

function calcSinalAbsoluto(v: string | null): Sinal {
  if (v == null) return 'neutro';
  const n = Number(v);
  if (Number.isNaN(n)) return 'neutro';
  if (n > 0) return 'verde';
  if (n < 0) return 'vermelho';
  return 'amarelo';
}

const SINAL_CLS: Record<Sinal, string> = {
  verde:    'text-emerald-600',
  amarelo:  'text-amber-500',
  vermelho: 'text-red-600',
  neutro:   'text-muted-foreground',
};

const SINAL_BG: Record<Sinal, string> = {
  verde:    'bg-emerald-50 border-emerald-200',
  amarelo:  'bg-amber-50   border-amber-200',
  vermelho: 'bg-red-50     border-red-200',
  neutro:   'bg-card       border-border',
};

function Semaforo({ sinal, pct }: Readonly<{ sinal: Sinal; pct?: number | null }>) {
  const cls = SINAL_CLS[sinal];
  if (sinal === 'neutro') return <span className="text-[11px] text-muted-foreground">—</span>;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-semibold', cls)}>
      {sinal === 'verde'    && <ArrowUpIcon   size={9} weight="bold" />}
      {sinal === 'vermelho' && <ArrowDownIcon  size={9} weight="bold" />}
      {sinal === 'amarelo'  && <MinusIcon      size={9} weight="bold" />}
      {pct != null ? `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%` : null}
    </span>
  );
}

/* ─── Célula de KPI ─────────────────────────────────────────────────────── */

function KpiCell({
  valor, sinal, pct,
}: Readonly<{ valor: string | null; sinal: Sinal; pct?: number | null }>) {
  return (
    <td className={cn('border border-border px-3 py-2.5 text-right', SINAL_BG[sinal])}>
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-sm font-bold tabular-nums text-foreground">{fmtBrl(valor)}</span>
        <Semaforo sinal={sinal} pct={pct} />
      </div>
    </td>
  );
}

/* ─── Componente principal ────────────────────────────────────────────────── */

export interface KpisAnuaisProps {
  kpis: KpiAnual[];
}

export function KpisAnuais({ kpis }: Readonly<KpisAnuaisProps>) {
  if (kpis.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Nenhum dado disponível.</p>
    );
  }

  // Ordena do mais recente para o mais antigo
  const sorted = [...kpis].sort((a, b) => b.exercicio - a.exercicio);

  // Mapeia exercicio → índice para lookup do ano anterior
  const byYear = new Map(sorted.map(k => [k.exercicio, k]));

  function calcPct(curr: string | null, prev: string | null): number | null {
    if (curr == null || prev == null) return null;
    const c = Number(curr);
    const p = Number(prev);
    if (Number.isNaN(c) || Number.isNaN(p) || p === 0) return null;
    return ((c - p) / Math.abs(p)) * 100;
  }

  const KPIS: {
    key: keyof Omit<KpiAnual, 'exercicio'>;
    label: string;
    sinalFn: (curr: KpiAnual, prev?: KpiAnual) => Sinal;
    pctFn:   (curr: KpiAnual, prev?: KpiAnual) => number | null;
  }[] = [
    {
      key: 'receitaLiquida',
      label: 'Receita Líquida',
      sinalFn: (c, p) => calcSinal(c.receitaLiquida, p?.receitaLiquida),
      pctFn:   (c, p) => calcPct(c.receitaLiquida, p?.receitaLiquida ?? null),
    },
    {
      key: 'ebitda',
      label: 'EBITDA',
      sinalFn: (c, p) => calcSinal(c.ebitda, p?.ebitda),
      pctFn:   (c, p) => calcPct(c.ebitda, p?.ebitda ?? null),
    },
    {
      key: 'lucroLiquido',
      label: 'Lucro Líquido',
      sinalFn: (c, p) => {
        const abs = calcSinalAbsoluto(c.lucroLiquido);
        if (abs !== 'verde') return abs;
        return calcSinal(c.lucroLiquido, p?.lucroLiquido);
      },
      pctFn: (c, p) => calcPct(c.lucroLiquido, p?.lucroLiquido ?? null),
    },
    {
      key: 'pl',
      label: 'Patrimônio Líquido',
      sinalFn: (c, p) => calcSinal(c.pl, p?.pl),
      pctFn:   (c, p) => calcPct(c.pl, p?.pl ?? null),
    },
  ];

  return (
    <div className="overflow-x-auto rounded-xl border border-border shadow-sm">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-muted/50">
            <th className="border border-border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground w-36">
              KPI
            </th>
            {sorted.map(k => (
              <th key={k.exercicio} className="border border-border px-3 py-2 text-right text-xs font-semibold text-foreground">
                {k.exercicio}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {KPIS.map(({ key, label, sinalFn, pctFn }) => (
            <tr key={key} className="hover:bg-muted/20">
              <td className="border border-border px-3 py-2.5 text-xs font-medium text-muted-foreground bg-muted/30 whitespace-nowrap">
                {label}
              </td>
              {sorted.map(curr => {
                const prev = byYear.get(curr.exercicio - 1);
                return (
                  <KpiCell
                    key={curr.exercicio}
                    valor={curr[key]}
                    sinal={sinalFn(curr, prev)}
                    pct={pctFn(curr, prev)}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
