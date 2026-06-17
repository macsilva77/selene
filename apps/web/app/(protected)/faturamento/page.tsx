'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast, ToastContainer } from '@/components/ui/toast';
import {
  faturamentoApi,
  type FaturamentoConsolidado,
  type FaturamentoConsolidadoAno,
  type EmpresaFaturamento,
} from '@/lib/faturamento-api';

/* ─── Formatação ─────────────────────────────────────────────────────────── */

function fmtBrl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtBrlCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `R$ ${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `R$ ${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `R$ ${(v / 1e3).toFixed(0)}K`;
  return fmtBrl(v);
}

function fmtPct(num: number, den: number): string {
  if (den === 0) return '—';
  return `${((num / den) * 100).toFixed(1)}%`;
}

function maskCnpj(cnpj: string): string {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

/* ─── Constantes ─────────────────────────────────────────────────────────── */

const ANO_CORRENTE = new Date().getFullYear();

const FONTES = [
  { value: 'AMBOS',      label: 'Ambas as fontes' },
  { value: 'EFD_ICMS',   label: 'EFD ICMS/IPI' },
  { value: 'EFD_CONTRIB', label: 'EFD Contribuições' },
];

const CHART_CONFIG: ChartConfig = {
  vlFaturamentoBruto: { label: 'Faturamento Bruto', color: '#3B82F6' },
  vlComprasBruto:     { label: 'Compras Brutas',    color: '#F97316' },
};

/* ─── Skeleton ────────────────────────────────────────────────────────────── */

function Skeleton({ className }: Readonly<{ className?: string }>) {
  return <div className={`animate-pulse rounded bg-muted ${className ?? ''}`} />;
}

/* ─── Gráfico ─────────────────────────────────────────────────────────────── */

interface ChartDatum {
  ano: string;
  vlFaturamentoBruto: number;
  vlComprasBruto: number;
}

function GraficoFaturamento({ anos }: Readonly<{ anos: FaturamentoConsolidadoAno[] }>) {
  const data: ChartDatum[] = anos.map(a => ({
    ano:                String(a.ano),
    vlFaturamentoBruto: a.vlFaturamentoBruto,
    vlComprasBruto:     a.vlComprasBruto,
  }));

  if (data.length === 0) {
    return (
      <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
        Nenhum dado para o período selecionado
      </div>
    );
  }

  return (
    <ChartContainer config={CHART_CONFIG} className="h-64 w-full">
      <ComposedChart data={data} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="ano"
          tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={fmtBrlCompact}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
          width={90}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => fmtBrl(Number(value))}
              labelFormatter={String}
            />
          }
        />
        <Legend
          wrapperStyle={{ fontSize: 12 }}
          formatter={(value) => CHART_CONFIG[value]?.label ?? value}
        />
        <Bar
          dataKey="vlFaturamentoBruto"
          name="vlFaturamentoBruto"
          fill="#3B82F6"
          radius={[3, 3, 0, 0]}
          maxBarSize={60}
        />
        <Line
          type="monotone"
          dataKey="vlComprasBruto"
          name="vlComprasBruto"
          stroke="#F97316"
          strokeWidth={2.5}
          dot={{ r: 4, fill: '#F97316' }}
          activeDot={{ r: 6 }}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

/* ─── Cards KPI ───────────────────────────────────────────────────────────── */

function KpiCard({
  label, value, sub,
}: Readonly<{ label: string; value: string; sub?: string }>) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-lg font-semibold tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

/* ─── Tabela multi-ano ────────────────────────────────────────────────────── */

interface MetricRow {
  label:   string;
  key:     keyof FaturamentoConsolidadoAno | 'relacaoFatCompras';
  format?: (v: number, row: FaturamentoConsolidadoAno) => string;
}

const METRICAS: MetricRow[] = [
  { label: 'Faturamento Bruto',    key: 'vlFaturamentoBruto',   format: (v) => fmtBrl(v) },
  { label: 'Compras Brutas',       key: 'vlComprasBruto',       format: (v) => fmtBrl(v) },
  { label: 'Relação Fat./Compras', key: 'relacaoFatCompras',    format: (_, r) => fmtPct(r.vlFaturamentoBruto, r.vlComprasBruto) },
  { label: 'ICMS',                 key: 'vlIcms',               format: (v) => fmtBrl(v) },
  { label: 'IPI',                  key: 'vlIpi',                format: (v) => fmtBrl(v) },
  { label: 'PIS',                  key: 'vlPis',                format: (v) => fmtBrl(v) },
  { label: 'COFINS',               key: 'vlCofins',             format: (v) => fmtBrl(v) },
  { label: 'Qtd Documentos',       key: 'qtdDocumentos',        format: (v) => v.toLocaleString('pt-BR') },
  { label: 'Qtd Doc. Compras',     key: 'qtdDocumentosCompras', format: (v) => v.toLocaleString('pt-BR') },
  { label: 'Meses Processados',    key: 'mesesProcessados',     format: (v) => String(v) },
];

function TabelaConsolidada({ anos }: Readonly<{ anos: FaturamentoConsolidadoAno[] }>) {
  if (anos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        Nenhum dado encontrado para o período.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 pr-4 font-medium text-muted-foreground w-44">Indicador</th>
            {anos.map(a => (
              <th key={a.ano} className="text-right py-2 px-3 font-medium">{a.ano}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRICAS.map((m, i) => (
            <tr
              key={m.key}
              className={[
                'border-b border-border/40 hover:bg-muted/30 transition-colors',
                i === 0 || i === 1 ? 'font-medium' : '',
              ].join(' ')}
            >
              <td className="py-2 pr-4 text-muted-foreground">{m.label}</td>
              {anos.map(a => {
                const raw = m.key === 'relacaoFatCompras'
                  ? 0
                  : Number(a[m.key as keyof FaturamentoConsolidadoAno] ?? 0);
                const display = m.format
                  ? m.format(raw, a)
                  : fmtBrl(raw);
                return (
                  <td key={a.ano} className="text-right py-2 px-3 tabular-nums">{display}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Página principal ────────────────────────────────────────────────────── */

export default function FaturamentoDashboardPage() {
  const { toasts, error: toastError, dismiss } = useToast();

  const [empresas, setEmpresas]       = useState<EmpresaFaturamento[]>([]);
  const [empresaId, setEmpresaId]     = useState('');
  const [fonte, setFonte]             = useState('AMBOS');
  const [anoInicio, setAnoInicio]     = useState(ANO_CORRENTE - 4);
  const [anoFim, setAnoFim]           = useState(ANO_CORRENTE);
  const [dados, setDados]             = useState<FaturamentoConsolidado | null>(null);
  const [carregando, setCarregando]   = useState(false);
  const [loadingEmpresas, setLoadingEmpresas] = useState(true);

  // Carrega lista de empresas
  useEffect(() => {
    faturamentoApi.listarEmpresas()
      .then(list => {
        setEmpresas(list);
        if (list.length > 0 && list[0]) setEmpresaId(list[0].id);
      })
      .catch(() => toastError('Não foi possível carregar as empresas.'))
      .finally(() => setLoadingEmpresas(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buscar = useCallback(() => {
    if (!empresaId) return;
    setCarregando(true);
    faturamentoApi
      .consolidado({ empresaId, anoInicio, anoFim, fonte })
      .then(setDados)
      .catch(() => toastError('Erro ao buscar dados de faturamento.'))
      .finally(() => setCarregando(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, fonte, anoInicio, anoFim]);

  // Busca automaticamente quando empresa ou filtros mudam
  useEffect(() => {
    if (empresaId) buscar();
  }, [empresaId, buscar]);

  // Totais do período completo
  const totais = dados?.anos.reduce(
    (acc, a) => ({
      faturamento: acc.faturamento + a.vlFaturamentoBruto,
      compras:     acc.compras     + a.vlComprasBruto,
      icms:        acc.icms        + a.vlIcms,
      docs:        acc.docs        + a.qtdDocumentos,
    }),
    { faturamento: 0, compras: 0, icms: 0, docs: 0 },
  );

  const anosDisponiveis = Array.from({ length: 10 }, (_, i) => ANO_CORRENTE - i);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto">

      {/* Cabeçalho */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard de Faturamento</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Faturamento e compras consolidados por ano, extraídos do SPED EFD.
        </p>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* Empresa */}
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground block mb-1">Empresa</label>
              {loadingEmpresas ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={empresaId}
                  onChange={e => setEmpresaId(e.target.value)}
                >
                  {empresas.length === 0 && (
                    <option value="">Nenhuma empresa encontrada</option>
                  )}
                  {empresas.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.nomeFantasia ?? e.nome} — {maskCnpj(e.cnpj.padStart(14, '0'))}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Fonte */}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Fonte</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={fonte}
                onChange={e => setFonte(e.target.value)}
              >
                {FONTES.map(f => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>

            {/* Período */}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Período</label>
              <div className="flex items-center gap-1.5">
                <select
                  className="flex-1 rounded-md border border-input bg-background px-2 py-2 text-sm"
                  value={anoInicio}
                  onChange={e => setAnoInicio(Number(e.target.value))}
                >
                  {anosDisponiveis.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <span className="text-muted-foreground text-xs">–</span>
                <select
                  className="flex-1 rounded-md border border-input bg-background px-2 py-2 text-sm"
                  value={anoFim}
                  onChange={e => setAnoFim(Number(e.target.value))}
                >
                  {anosDisponiveis.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {carregando && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardContent className="p-4 space-y-2">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-6 w-full" />
            </CardContent></Card>
          ))}
        </div>
      )}

      {!carregando && dados && (
        <>
          {/* Cards KPI */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KpiCard
              label="Faturamento total"
              value={fmtBrlCompact(totais?.faturamento ?? 0)}
              sub={`${dados.anos.length} ano(s) · ${fmtBrl(totais?.faturamento ?? 0)}`}
            />
            <KpiCard
              label="Compras totais"
              value={fmtBrlCompact(totais?.compras ?? 0)}
              sub={fmtBrl(totais?.compras ?? 0)}
            />
            <KpiCard
              label="Relação Fat./Compras"
              value={fmtPct(totais?.faturamento ?? 0, totais?.compras ?? 0)}
              sub="faturamento / compras"
            />
            <KpiCard
              label="ICMS total"
              value={fmtBrlCompact(totais?.icms ?? 0)}
              sub={fmtBrl(totais?.icms ?? 0)}
            />
          </div>

          {/* Gráfico */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">
                Faturamento vs Compras por Ano
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {dados.nome} — {maskCnpj(dados.cnpj.padStart(14, '0'))} · fonte: {fonte}
              </p>
            </CardHeader>
            <CardContent className="pt-0">
              <GraficoFaturamento anos={dados.anos} />
            </CardContent>
          </Card>

          {/* Tabela consolidada */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">
                Consolidado por Ano
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <TabelaConsolidada anos={dados.anos} />
            </CardContent>
          </Card>
        </>
      )}

      {!carregando && !dados && !loadingEmpresas && empresas.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma empresa cadastrada. Cadastre empresas e processe arquivos EFD ICMS/IPI para visualizar o faturamento.
          </CardContent>
        </Card>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
