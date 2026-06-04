'use client';

import React from 'react';
import {
  XCircleIcon, WarningIcon, CheckCircleIcon,
  TrendUpIcon, ChartBarIcon, CurrencyDollarIcon,
  BuildingsIcon,
} from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Indicador, Alerta, ResumoFinanceiro } from '@/lib/analise-credito-api';

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function fmtBrl(v: string | number | null | undefined, abrev = true): string {
  if (v == null) return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  if (abrev) {
    if (Math.abs(n) >= 1e9) return `R$ ${(n / 1e9).toFixed(1)}B`;
    if (Math.abs(n) >= 1e6) return `R$ ${(n / 1e6).toFixed(1)}M`;
    if (Math.abs(n) >= 1e3) return `R$ ${(n / 1e3).toFixed(1)}K`;
  }
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtRatio(v: string | null | undefined, unidade: string): string {
  if (v == null) return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  if (unidade === 'percentual') return `${(n * 100).toFixed(1)}%`;
  if (unidade === 'dias')       return `${n.toFixed(0)} dias`;
  if (unidade === 'ratio')      return `${n.toFixed(2)}x`;
  if (unidade === 'reais')      return fmtBrl(n);
  return n.toFixed(2);
}

function getInd(indicadores: Indicador[], nome: string, exercicio?: number): Indicador | undefined {
  return indicadores.find(i => i.indicador === nome && (exercicio === undefined || i.exercicio === exercicio));
}

/* ─── Badge semáforo ─────────────────────────────────────────────────────── */

const SEV_BADGE: Record<string, { cls: string; label: string }> = {
  positivo: { cls: 'bg-emerald-100 text-emerald-800 border-emerald-300', label: 'adequado' },
  atencao:  { cls: 'bg-yellow-100 text-yellow-800 border-yellow-300',    label: 'atenção'  },
  critico:  { cls: 'bg-red-100 text-red-800 border-red-300',             label: 'crítico'  },
};

function SemaforoBadge({ severidade }: { severidade?: string }) {
  const cfg = severidade ? SEV_BADGE[severidade] : null;
  if (!cfg) return null;
  return <Badge className={cn('text-[10px] font-medium border', cfg.cls)}>{cfg.label}</Badge>;
}

/* ─── KPI Card ───────────────────────────────────────────────────────────── */

function KpiCard({
  label, valor, sub, icon, severidade,
}: {
  label: string;
  valor: string;
  sub?: string;
  icon?: React.ReactNode;
  severidade?: string;
}) {
  return (
    <Card className="border">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            <p className="mt-1 text-xl font-bold text-foreground tabular-nums">{valor}</p>
            {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {icon && <span className="text-muted-foreground">{icon}</span>}
            {severidade && <SemaforoBadge severidade={severidade} />}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Indicadores de liquidez e rentabilidade ─────────────────────────────── */

const IND_LISTA = [
  { key: 'liquidez_corrente', label: 'Liquidez corrente',  unidade: 'ratio' },
  { key: 'liquidez_seca',     label: 'Liquidez seca',      unidade: 'ratio' },
  { key: 'liquidez_imediata', label: 'Liquidez imediata',  unidade: 'ratio' },
  { key: 'margem_ebitda',     label: 'Margem EBITDA',      unidade: 'percentual' },
  { key: 'margem_liquida',    label: 'Margem líquida',     unidade: 'percentual' },
  { key: 'roe',               label: 'ROE',                unidade: 'percentual' },
  { key: 'roa',               label: 'ROA',                unidade: 'percentual' },
  { key: 'roic',              label: 'ROIC',               unidade: 'percentual' },
  { key: 'ciclo_financeiro',  label: 'Ciclo financeiro',   unidade: 'dias' },
  { key: 'dl_ebitda',         label: 'DL / EBITDA',        unidade: 'ratio' },
  { key: 'cobertura_juros',   label: 'Cobertura de juros', unidade: 'ratio' },
];

/* ─── Barra de composição do ativo ──────────────────────────────────────── */

const BARRA_CORES = ['bg-emerald-400', 'bg-blue-400', 'bg-amber-400', 'bg-slate-400', 'bg-violet-400'];

interface BarItem { label: string; valor: number; cor: string }

function BarraComposicao({ items, total }: { items: BarItem[]; total: number }) {
  if (total === 0) return null;
  return (
    <div className="space-y-2">
      {items.map(item => {
        const pct = total > 0 ? (item.valor / total) * 100 : 0;
        return (
          <div key={item.label} className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-xs text-right text-muted-foreground">{item.label}</span>
            <div className="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all', item.cor)}
                style={{ width: `${pct.toFixed(1)}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-xs text-right font-medium text-foreground">
              {pct.toFixed(0)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Componente principal ───────────────────────────────────────────────── */

interface VisaoGeralProps {
  exercicio:   number;
  indicadores: Indicador[];
  alertas:     Alerta[];
  financeiro:  ResumoFinanceiro | null;
}

export function VisaoGeral({ exercicio, indicadores, alertas, financeiro }: VisaoGeralProps) {
  // Índice de alerta por indicador
  const alertaMap = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const a of alertas.filter(a => a.exercicio === exercicio)) {
      if (!m.has(a.indicador) || a.severidade === 'critico') m.set(a.indicador, a.severidade);
    }
    return m;
  }, [alertas, exercicio]);

  const ind = (nome: string) => getInd(indicadores, nome, exercicio);
  const sev = (nome: string) => alertaMap.get(nome);

  const criticos  = alertas.filter(a => a.exercicio === exercicio && a.severidade === 'critico').length;
  const atencao   = alertas.filter(a => a.exercicio === exercicio && a.severidade === 'atencao').length;
  const positivos = alertas.filter(a => a.exercicio === exercicio && a.severidade === 'positivo').length;

  const ec = financeiro?.estrutura;
  const dre = financeiro?.dre ?? {};

  // Composição do ativo a partir de estrutura (aproximação)
  const ativoTotal = Number(ec?.ativoTotal ?? 0);
  const divCP  = Number(ec?.dividaFinanceiraCp  ?? 0);
  const divLP  = Number(ec?.dividaFinanceiraLp  ?? 0);
  const pl     = Number(ec?.pl ?? 0);
  const passivo = Number(ec?.passivoTotal ?? 0);

  const barItems: BarItem[] = [
    { label: 'Caixa',       valor: Number(ind('caixa_equiv')?.valor ?? 0), cor: BARRA_CORES[0] },
    { label: 'Dív. CP',     valor: divCP,  cor: BARRA_CORES[1] },
    { label: 'Dív. LP',     valor: divLP,  cor: BARRA_CORES[2] },
    { label: 'PL',          valor: pl,     cor: BARRA_CORES[3] },
    { label: 'Outros',      valor: Math.max(0, passivo - divCP - divLP - pl), cor: BARRA_CORES[4] },
  ].filter(b => b.valor > 0);

  return (
    <div className="flex flex-col gap-4">

      {/* ── Cartões de resumo ── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <XCircleIcon weight="fill" className="text-red-500 shrink-0" size={20} />
          <div>
            <p className="text-xs text-red-700">Alertas críticos</p>
            <p className="text-2xl font-bold text-red-700">{criticos}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3">
          <WarningIcon weight="fill" className="text-yellow-600 shrink-0" size={20} />
          <div>
            <p className="text-xs text-yellow-700">Pontos de atenção</p>
            <p className="text-2xl font-bold text-yellow-700">{atencao}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <CheckCircleIcon weight="fill" className="text-emerald-600 shrink-0" size={20} />
          <div>
            <p className="text-xs text-emerald-700">Indicadores positivos</p>
            <p className="text-2xl font-bold text-emerald-700">{positivos}</p>
          </div>
        </div>
      </div>

      {/* ── KPIs principais ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Receita líquida"
          valor={fmtBrl(dre['receita_liquida'])}
          icon={<TrendUpIcon size={16} />}
          severidade={sev('margem_ebitda')}
        />
        <KpiCard
          label="EBITDA"
          valor={fmtBrl(dre['ebitda'])}
          sub={ind('margem_ebitda') ? `Margem ${fmtRatio(ind('margem_ebitda')?.valor, 'percentual')}` : undefined}
          icon={<ChartBarIcon size={16} />}
        />
        <KpiCard
          label="Lucro líquido"
          valor={fmtBrl(dre['lucro_liquido'])}
          sub={ind('margem_liquida') ? `Margem ${fmtRatio(ind('margem_liquida')?.valor, 'percentual')}` : undefined}
          icon={<CurrencyDollarIcon size={16} />}
        />
        <KpiCard
          label="Patrimônio líquido"
          valor={fmtBrl(ec?.pl)}
          icon={<BuildingsIcon size={16} />}
          severidade={sev('roe')}
        />
      </div>

      {/* ── KPIs de dívida e liquidez ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Dívida financeira"
          valor={fmtBrl(ec?.dividaFinanceiraTot)}
          sub={`CP ${fmtBrl(ec?.dividaFinanceiraCp)} · LP ${fmtBrl(ec?.dividaFinanceiraLp)}`}
          severidade={sev('dl_ebitda')}
        />
        <KpiCard
          label="Dívida líquida / EBITDA"
          valor={fmtRatio(ind('dl_ebitda')?.valor, 'ratio')}
          severidade={sev('dl_ebitda')}
        />
        <KpiCard
          label="Liquidez corrente"
          valor={fmtRatio(ind('liquidez_corrente')?.valor, 'ratio')}
          severidade={sev('liquidez_corrente')}
        />
        <KpiCard
          label="Cobertura de juros"
          valor={fmtRatio(ind('cobertura_juros')?.valor, 'ratio')}
          severidade={sev('cobertura_juros')}
        />
      </div>

      {/* ── Composição do passivo ── */}
      {barItems.length > 0 && (
        <Card className="border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Composição das obrigações
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BarraComposicao items={barItems} total={barItems.reduce((s, b) => s + b.valor, 0)} />
            <p className="mt-2 text-xs text-muted-foreground">
              Ativo total: {fmtBrl(ativoTotal, false)}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Indicadores de liquidez e rentabilidade ── */}
      <Card className="border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Indicadores de liquidez e rentabilidade
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {IND_LISTA.map(({ key, label, unidade }) => {
            const item = ind(key);
            if (!item) return null;
            return (
              <div
                key={key}
                className="flex items-center justify-between border-b last:border-0 px-4 py-2.5 hover:bg-muted/30"
              >
                <span className="text-sm text-foreground">{label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums">
                    {fmtRatio(item.valor, unidade)}
                  </span>
                  <SemaforoBadge severidade={alertaMap.get(key)} />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

    </div>
  );
}
