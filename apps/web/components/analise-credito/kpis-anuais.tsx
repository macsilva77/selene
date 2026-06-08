'use client';

import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LabelList, ResponsiveContainer,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { KpiAnual } from '@/lib/analise-credito-api';

/* ─── Formatação ─────────────────────────────────────────────────────────── */

function fmtBrl(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `R$ ${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `R$ ${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `R$ ${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function pctStr(curr: number, prev: number): string {
  if (prev === 0) return '';
  const p = ((curr - prev) / Math.abs(prev)) * 100;
  return `${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
}

function totalGrowthLabel(first: number | null, last: number | null): string {
  if (first == null || last == null || first === 0) return '';
  const g = ((last - first) / Math.abs(first)) * 100;
  if (Math.abs(g) < 2) return 'estável';
  return g > 0 ? `crescimento acumulado +${g.toFixed(0)}%` : `queda acumulada ${g.toFixed(0)}%`;
}

/* ─── Custom bar shape (evita Cell deprecated em recharts v3) ─────────────── */

interface BarShapeProps {
  x?: number; y?: number; width?: number; height?: number; index?: number;
}

function makeBarShape(dados: BarData[]) {
  return function BarShape({ x = 0, y = 0, width = 0, height = 0, index = 0 }: BarShapeProps) {
    const cor = dados[index]?.cor ?? '#94a3b8';
    if (width <= 0 || height <= 0) return null;
    return <rect x={x} y={y} width={width} height={height} fill={cor} rx={3} ry={3} />;
  };
}

/* ─── Cores por paleta ────────────────────────────────────────────────────── */

const PALETAS: Record<string, string[]> = {
  receita: ['#BFDBFE','#93C5FD','#60A5FA','#3B82F6','#1D4ED8','#1E3A8A'],
  ebitda:  ['#BBF7D0','#86EFAC','#4ADE80','#22C55E','#15803D','#14532D'],
  pl:      ['#DDD6FE','#C4B5FD','#A78BFA','#7C3AED','#6D28D9','#4C1D95'],
  divida:  ['#FECACA','#FCA5A5','#F87171','#EF4444','#B91C1C','#7F1D1D'],
};

function paletteCor(paleta: string, idx: number, total: number): string {
  const cores = PALETAS[paleta] ?? PALETAS.receita;
  const step  = cores.length > 1 ? (cores.length - 1) / Math.max(total - 1, 1) : 0;
  const i     = Math.min(Math.round(idx * step), cores.length - 1);
  return cores[i] ?? cores.at(-1) ?? '#94a3b8';
}

/* ─── Gráfico de barras horizontal ───────────────────────────────────────── */

interface BarData {
  ano:     string;
  valor:   number;
  yoy:     string;
  extra?:  string;
  cor:     string;
}

const config: ChartConfig = { valor: { label: 'Valor' } };

interface KpiBlockProps {
  titulo:    string;
  subtitulo: string;
  dados:     BarData[];
  fmtValue?: (v: number) => string;
}

function KpiBlock({ titulo, subtitulo, dados, fmtValue = fmtBrl }: Readonly<KpiBlockProps>) {
  const height = Math.max(dados.length * 44 + 16, 100);

  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-sm font-semibold text-foreground">{titulo}</p>
        {subtitulo && <p className="text-xs text-muted-foreground">{subtitulo}</p>}
      </div>

      <ChartContainer config={config} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={dados}
            layout="vertical"
            margin={{ top: 0, right: 80, left: 4, bottom: 0 }}
            barSize={22}
          >
            <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <YAxis
              dataKey="ano"
              type="category"
              width={36}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
            />
            <XAxis
              type="number"
              hide
              domain={[0, 'dataMax']}
            />
            <ChartTooltip
              cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
              content={
                <ChartTooltipContent
                  formatter={(value) => fmtValue(Number(value))}
                  labelFormatter={String}
                />
              }
            />
            <Bar dataKey="valor" shape={makeBarShape(dados)}>
              <LabelList
                dataKey="valor"
                position="right"
                formatter={(v: number) => fmtValue(v)}
                className="text-[11px] font-semibold fill-foreground"
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>

      {/* YoY + extra — pl-10 alinha com YAxis(36px)+margin(4px), pr-20 com margin right(80px) */}
      <div className="flex flex-col gap-0 pl-10 pr-20">
        {dados.map(d => {
          let yoyCls = 'text-muted-foreground';
          if (d.yoy.startsWith('+')) yoyCls = 'text-emerald-600';
          if (d.yoy.startsWith('-')) yoyCls = 'text-red-600';
          return (
          <div key={d.ano} className="flex h-11 items-center justify-between">
            <span className={`text-[11px] font-medium ${yoyCls}`}>
              {d.yoy}
            </span>
            {d.extra && (
              <span className="text-[11px] text-muted-foreground">{d.extra}</span>
            )}
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
  const sorted = useMemo(
    () => [...kpis].sort((a, b) => a.exercicio - b.exercicio),
    [kpis],
  );

  if (sorted.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum dado disponível.</p>;
  }

  function toDados(
    key: keyof Omit<KpiAnual, 'exercicio'>,
    paleta: string,
    extraFn?: (k: KpiAnual) => string,
  ): BarData[] {
    return sorted.map((k, idx) => {
      const val  = Math.abs(Number(k[key] ?? 0));
      const prev = sorted[idx - 1];
      let yoy = 'base';
      if (idx !== 0) yoy = prev ? pctStr(val, Math.abs(Number(prev[key] ?? 0))) : '';
      return {
        ano:   String(k.exercicio),
        valor: val,
        yoy,
        extra: extraFn?.(k),
        cor:   paletteCor(paleta, idx, sorted.length),
      };
    });
  }

  const dadosReceita = toDados('receitaLiquida', 'receita');
  const dadosEbitda  = toDados('ebitda', 'ebitda', k => {
    const e = Number(k.ebitda);
    const r = Number(k.receitaLiquida);
    return r > 0 ? `${((e / r) * 100).toFixed(1)}%` : '';
  });
  const dadosPl     = toDados('pl', 'pl');
  const dadosDivida = toDados('dividaFinanceira', 'divida');

  const subReceita = totalGrowthLabel(
    sorted[0]?.receitaLiquida ? Number(sorted[0].receitaLiquida) : null,
    sorted.at(-1)?.receitaLiquida ? Number(sorted.at(-1)!.receitaLiquida) : null,
  );

  const ebitdaMargens = sorted.map(k => {
    const e = Number(k.ebitda);
    const r = Number(k.receitaLiquida);
    return r > 0 ? e / r : null;
  }).filter((m): m is number => m !== null);
  const margDelta = ebitdaMargens.length >= 2
    ? ((ebitdaMargens.at(-1) ?? 0) - (ebitdaMargens[0] ?? 0)) * 100
    : 0;
  let subEbitda = 'margem estável';
  if (Math.abs(margDelta) >= 0.5) subEbitda = margDelta > 0 ? 'margem em expansão' : 'margem em contração';

  const subPl     = totalGrowthLabel(
    sorted[0]?.pl ? Number(sorted[0].pl) : null,
    sorted.at(-1)?.pl ? Number(sorted.at(-1)!.pl) : null,
  );
  const subDivida = totalGrowthLabel(
    sorted[0]?.dividaFinanceira ? Number(sorted[0].dividaFinanceira) : null,
    sorted.at(-1)?.dividaFinanceira ? Number(sorted.at(-1)!.dividaFinanceira) : null,
  );

  return (
    <div className="flex flex-col gap-10">
      <KpiBlock titulo="Receita líquida"   subtitulo={subReceita} dados={dadosReceita} />
      <KpiBlock titulo="EBITDA"            subtitulo={subEbitda}  dados={dadosEbitda} />

      <div className="grid grid-cols-1 gap-10 sm:grid-cols-2">
        <KpiBlock titulo="Patrimônio líquido" subtitulo={subPl}     dados={dadosPl}     />
        <KpiBlock titulo="Dívida financeira"  subtitulo={subDivida} dados={dadosDivida} />
      </div>
    </div>
  );
}
