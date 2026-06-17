'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ComposedChart, BarChart,
  Bar, Line, XAxis, YAxis, CartesianGrid, Legend,
  ResponsiveContainer,
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
  type FaturamentoCfopsConsolidado,
  type FaturamentoCfopsAno,
  type EmpresaFaturamento,
} from '@/lib/faturamento-api';

/* ─── Formatação ─────────────────────────────────────────────────────────── */

function fmtBrl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtMilhoes(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)} Bi`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(0)} Milhões`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(0)} Mil`;
  return v.toLocaleString('pt-BR');
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

function maskCnpj(cnpj: string): string {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

/* ─── Constantes ─────────────────────────────────────────────────────────── */

const ANO_CORRENTE = new Date().getFullYear();

const FONTES = [
  { value: 'AMBOS',       label: 'Ambas as fontes' },
  { value: 'EFD_ICMS',    label: 'EFD ICMS/IPI' },
  { value: 'EFD_CONTRIB', label: 'EFD Contribuições' },
];

/* ─── Chart configs ──────────────────────────────────────────────────────── */

const CFG_PRINCIPAL: ChartConfig = {
  vlComprasBruto:    { label: 'Total de compras',        color: '#3B5BDB' },
  vlFaturamentoBruto:{ label: 'Total de vendas',          color: '#37B24D' },
  vlDevolucoes:      { label: 'Devoluções de compras',   color: '#F59F00' },
  vlFatLiquido:      { label: 'Devoluções de vendas',    color: '#E03131' },
};

const CFG_VALORES: ChartConfig = {
  vlFaturamentoBruto: { label: 'Faturamento Bruto',               color: '#3B5BDB' },
  vlMercadorias:      { label: 'Faturamento Bruto c/ Mercadorias', color: '#37B24D' },
  vlDevolucoes:       { label: 'Total de Devoluções',             color: '#F59F00' },
  vlFatLiquido:       { label: 'Faturamento Líquido de Devolução', color: '#E03131' },
  vlTransferencias:   { label: 'Total em Transferências',         color: '#1098AD' },
  vlRemessas:         { label: 'Total em Remessas',               color: '#7950F2' },
};

const CFG_INDICES: ChartConfig = {
  idxEstadual:      { label: 'Índice de Vendas no Estado',        color: '#3B5BDB' },
  idxInterestadual: { label: 'Índice de Vendas fora do Estado',   color: '#37B24D' },
  idxExportacao:    { label: 'Índice de Exportação',              color: '#F59F00' },
  idxDevolucao:     { label: 'Índice de Devoluções - Vendas',     color: '#E03131' },
};

/* ─── Skeleton ───────────────────────────────────────────────────────────── */

function Skeleton({ className }: Readonly<{ className?: string }>) {
  return <div className={`animate-pulse rounded bg-muted ${className ?? ''}`} />;
}

function PanelSkeleton() {
  return <Skeleton className="h-72 w-full" />;
}

/* ─── Formatador de eixo Y ───────────────────────────────────────────────── */

function yTickMilhoes(v: number): string { return fmtMilhoes(v); }
function yTickPct(v: number): string { return `${(v * 100).toFixed(0)}%`; }

/* ─── Painel 1: Vendas Brutas × Compras Brutas ───────────────────────────── */

function PainelVendasCompras({ anos }: Readonly<{ anos: FaturamentoCfopsAno[] }>) {
  type D = {
    ano: string;
    vlComprasBruto: number;
    vlFaturamentoBruto: number;
    vlDevolucoes: number;
    vlFatLiquido: number;
  };

  const data: D[] = anos.map(a => ({
    ano:                String(a.ano),
    vlComprasBruto:     a.vlComprasBruto,
    vlFaturamentoBruto: a.vlFaturamentoBruto,
    vlDevolucoes:       a.vlDevolucoes,
    vlFatLiquido:       a.vlFatLiquido,
  }));

  if (data.length === 0) return <EmptyChart />;

  const maxBar = Math.max(...data.map(d => Math.max(d.vlComprasBruto, d.vlFaturamentoBruto)));
  const maxLine = Math.max(...data.map(d => Math.max(d.vlDevolucoes, d.vlFatLiquido)));

  return (
    <ChartContainer config={CFG_PRINCIPAL} className="h-72 w-full">
      <ComposedChart data={data} margin={{ top: 8, right: 60, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="ano"
          tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false} tickLine={false}
          label={{ value: 'Mês/Ano:', position: 'insideBottomLeft', offset: -4, fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
        />
        {/* Eixo esquerdo: barras */}
        <YAxis
          yAxisId="left"
          tickFormatter={yTickMilhoes}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false} tickLine={false} width={90}
          domain={[0, maxBar * 1.15]}
          label={{ value: 'Total de compras e vendas', angle: -90, position: 'insideLeft', offset: 10, fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
        />
        {/* Eixo direito: linhas de devoluções */}
        <YAxis
          yAxisId="right"
          orientation="right"
          tickFormatter={yTickMilhoes}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false} tickLine={false} width={80}
          domain={[0, maxLine * 1.3 || 1]}
          label={{ value: 'Devoluções e cancelamentos', angle: 90, position: 'insideRight', offset: 10, fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
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
          wrapperStyle={{ fontSize: 11 }}
          formatter={(key) => CFG_PRINCIPAL[key]?.label ?? key}
        />
        <Bar yAxisId="left" dataKey="vlComprasBruto"     name="vlComprasBruto"     fill="#3B5BDB" radius={[3,3,0,0]} maxBarSize={55} />
        <Bar yAxisId="left" dataKey="vlFaturamentoBruto" name="vlFaturamentoBruto" fill="#37B24D" radius={[3,3,0,0]} maxBarSize={55} />
        <Line yAxisId="right" type="monotone" dataKey="vlDevolucoes"  name="vlDevolucoes"  stroke="#F59F00" strokeWidth={2} dot={{ r: 4, fill:'#F59F00' }} activeDot={{ r:5 }} />
        <Line yAxisId="right" type="monotone" dataKey="vlFatLiquido"  name="vlFatLiquido"  stroke="#E03131" strokeWidth={2} dot={{ r: 4, fill:'#E03131' }} activeDot={{ r:5 }} />
      </ComposedChart>
    </ChartContainer>
  );
}

/* ─── Painel 2: Valores ─────────────────────────────────────────────────── */

function PainelValores({ anos }: Readonly<{ anos: FaturamentoCfopsAno[] }>) {
  type D = {
    ano: string;
    vlFaturamentoBruto: number;
    vlMercadorias: number;
    vlDevolucoes: number;
    vlFatLiquido: number;
    vlTransferencias: number;
    vlRemessas: number;
  };

  const data: D[] = anos.map(a => ({
    ano:                String(a.ano),
    vlFaturamentoBruto: a.vlFaturamentoBruto,
    vlMercadorias:      a.vlMercadorias,
    vlDevolucoes:       a.vlDevolucoes,
    vlFatLiquido:       a.vlFatLiquido,
    vlTransferencias:   a.vlTransferencias,
    vlRemessas:         a.vlRemessas,
  }));

  if (data.length === 0) return <EmptyChart />;

  return (
    <ChartContainer config={CFG_VALORES} className="h-64 w-full">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="ano" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={yTickMilhoes} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={85} />
        <ChartTooltip content={<ChartTooltipContent formatter={(v) => fmtBrl(Number(v))} labelFormatter={String} />} />
        <Legend wrapperStyle={{ fontSize: 10 }} formatter={(k) => CFG_VALORES[k]?.label ?? k} />
        <Bar dataKey="vlFaturamentoBruto" name="vlFaturamentoBruto" fill="#3B5BDB" maxBarSize={18} />
        <Bar dataKey="vlMercadorias"      name="vlMercadorias"      fill="#37B24D" maxBarSize={18} />
        <Bar dataKey="vlDevolucoes"       name="vlDevolucoes"       fill="#F59F00" maxBarSize={18} />
        <Bar dataKey="vlFatLiquido"       name="vlFatLiquido"       fill="#E03131" maxBarSize={18} />
        <Bar dataKey="vlTransferencias"   name="vlTransferencias"   fill="#1098AD" maxBarSize={18} />
        <Bar dataKey="vlRemessas"         name="vlRemessas"         fill="#7950F2" maxBarSize={18} />
      </BarChart>
    </ChartContainer>
  );
}

/* ─── Painel 3: Índices ──────────────────────────────────────────────────── */

import { LineChart, Line as ReLine } from 'recharts';

function PainelIndices({ anos }: Readonly<{ anos: FaturamentoCfopsAno[] }>) {
  type D = {
    ano: string;
    idxEstadual: number;
    idxInterestadual: number;
    idxExportacao: number;
    idxDevolucao: number;
  };

  const data: D[] = anos.map(a => ({
    ano:              String(a.ano),
    idxEstadual:      a.idxEstadual,
    idxInterestadual: a.idxInterestadual,
    idxExportacao:    a.idxExportacao,
    idxDevolucao:     a.idxDevolucao,
  }));

  if (data.length === 0) return <EmptyChart />;

  return (
    <ChartContainer config={CFG_INDICES} className="h-64 w-full">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="ano" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={yTickPct} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={55} domain={[0, 1]} />
        <ChartTooltip content={<ChartTooltipContent formatter={(v) => fmtPct(Number(v))} labelFormatter={String} />} />
        <Legend wrapperStyle={{ fontSize: 10 }} formatter={(k) => CFG_INDICES[k]?.label ?? k} />
        <ReLine type="monotone" dataKey="idxEstadual"      name="idxEstadual"      stroke="#3B5BDB" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
        <ReLine type="monotone" dataKey="idxInterestadual" name="idxInterestadual" stroke="#37B24D" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
        <ReLine type="monotone" dataKey="idxExportacao"    name="idxExportacao"    stroke="#F59F00" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
        <ReLine type="monotone" dataKey="idxDevolucao"     name="idxDevolucao"     stroke="#E03131" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
      </LineChart>
    </ChartContainer>
  );
}

/* ─── Empty state ────────────────────────────────────────────────────────── */

function EmptyChart() {
  return (
    <div className="h-56 flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-md">
      Nenhum dado para o período selecionado
    </div>
  );
}

/* ─── Cards KPI ──────────────────────────────────────────────────────────── */

function KpiCard({ label, value, sub }: Readonly<{ label: string; value: string; sub?: string }>) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-lg font-semibold tabular-nums leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

/* ─── Página principal ───────────────────────────────────────────────────── */

export default function FaturamentoDashboardPage() {
  const { toasts, error: toastError, dismiss } = useToast();

  const [empresas, setEmpresas]             = useState<EmpresaFaturamento[]>([]);
  const [empresaId, setEmpresaId]           = useState('');
  const [fonte, setFonte]                   = useState('AMBOS');
  const [anoInicio, setAnoInicio]           = useState(ANO_CORRENTE - 4);
  const [anoFim, setAnoFim]                 = useState(ANO_CORRENTE);
  const [dados, setDados]                   = useState<FaturamentoCfopsConsolidado | null>(null);
  const [carregando, setCarregando]         = useState(false);
  const [loadingEmpresas, setLoadingEmpresas] = useState(true);

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
      .cfopsConsolidado({ empresaId, anoInicio, anoFim, fonte })
      .then(setDados)
      .catch(() => toastError('Erro ao buscar dados de faturamento.'))
      .finally(() => setCarregando(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, fonte, anoInicio, anoFim]);

  useEffect(() => { if (empresaId) buscar(); }, [empresaId, buscar]);

  const totais = dados?.anos.reduce(
    (acc, a) => ({
      fat:      acc.fat      + a.vlFaturamentoBruto,
      compras:  acc.compras  + a.vlComprasBruto,
      dev:      acc.dev      + a.vlDevolucoes,
      liquido:  acc.liquido  + a.vlFatLiquido,
    }),
    { fat: 0, compras: 0, dev: 0, liquido: 0 },
  );

  const anosDisponiveis = Array.from({ length: 10 }, (_, i) => ANO_CORRENTE - i);

  return (
    <div className="flex flex-col gap-5 p-6 max-w-[1440px] mx-auto">

      {/* Cabeçalho */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Análise de Faturamento</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Vendas, compras e índices fiscais extraídos do SPED EFD ICMS/IPI por ano.
        </p>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label htmlFor="sel-empresa" className="text-xs font-medium text-muted-foreground block mb-1">Empresa</label>
              {loadingEmpresas ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <select
                  id="sel-empresa"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={empresaId}
                  onChange={e => setEmpresaId(e.target.value)}
                >
                  {empresas.length === 0 && <option value="">Nenhuma empresa</option>}
                  {empresas.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.nomeFantasia ?? e.nome} — {maskCnpj(e.cnpj.padStart(14, '0'))}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label htmlFor="sel-fonte" className="text-xs font-medium text-muted-foreground block mb-1">Fonte</label>
              <select
                id="sel-fonte"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={fonte}
                onChange={e => setFonte(e.target.value)}
              >
                {FONTES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Período</label>
              <div className="flex items-center gap-1.5">
                <select
                  id="sel-ano-inicio"
                  aria-label="Ano inicial"
                  className="flex-1 rounded-md border border-input bg-background px-2 py-2 text-sm"
                  value={anoInicio}
                  onChange={e => setAnoInicio(Number(e.target.value))}
                >
                  {anosDisponiveis.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
                <span className="text-muted-foreground text-xs">–</span>
                <select
                  id="sel-ano-fim"
                  aria-label="Ano final"
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

      {/* KPI cards */}
      {carregando ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardContent className="p-4 space-y-2">
              <Skeleton className="h-3 w-3/4" /><Skeleton className="h-6 w-full" />
            </CardContent></Card>
          ))}
        </div>
      ) : dados && totais && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <KpiCard label="Faturamento total"    value={fmtMilhoes(totais.fat)}    sub={fmtBrl(totais.fat)} />
          <KpiCard label="Compras totais"        value={fmtMilhoes(totais.compras)} sub={fmtBrl(totais.compras)} />
          <KpiCard label="Devoluções"            value={fmtMilhoes(totais.dev)}    sub={`${((totais.dev / (totais.fat || 1)) * 100).toFixed(1)}% do fat.`} />
          <KpiCard label="Faturamento líquido"   value={fmtMilhoes(totais.liquido)} sub={fmtBrl(totais.liquido)} />
        </div>
      )}

      {/* Painel 1 — Vendas Brutas x Compras Brutas */}
      {carregando ? <PanelSkeleton /> : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Vendas Brutas x Compras Brutas</CardTitle>
            {dados && (
              <p className="text-xs text-muted-foreground">
                {dados.nome} — {maskCnpj(dados.cnpj.padStart(14, '0'))} · {fonte}
              </p>
            )}
          </CardHeader>
          <CardContent className="pt-0">
            {dados ? <PainelVendasCompras anos={dados.anos} /> : <EmptyChart />}
          </CardContent>
        </Card>
      )}

      {/* Painéis 2 e 3 lado a lado */}
      {carregando ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <PanelSkeleton /><PanelSkeleton />
        </div>
      ) : dados && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Painel 2 — Valores */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Valores</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <PainelValores anos={dados.anos} />
            </CardContent>
          </Card>

          {/* Painel 3 — Índices */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Índices</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <PainelIndices anos={dados.anos} />
            </CardContent>
          </Card>
        </div>
      )}

      {!carregando && !dados && !loadingEmpresas && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Selecione uma empresa e período. Os gráficos aparecem assim que os arquivos EFD ICMS/IPI forem processados.
          </CardContent>
        </Card>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
