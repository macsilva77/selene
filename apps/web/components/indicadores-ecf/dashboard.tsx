'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CaretDownIcon, ArrowClockwiseIcon } from '@phosphor-icons/react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Card, CardContent } from '@/components/ui/card';
import { useToast, ToastContainer } from '@/components/ui/toast';
import { indicadoresEcfApi, type EcfIndicador, type EmpresaComEcf } from '@/lib/indicadores-ecf-api';

function formatarCnpj(cnpj: string): string {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function fmtBrl(valor: string | number): string {
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function labelRegime(regime: string): string {
  const mapa: Record<string, string> = {
    lucro_real:       'Lucro Real',
    lucro_presumido:  'Lucro Presumido',
    lucro_arbitrado:  'Lucro Arbitrado',
    imune_isenta:     'Imune/Isenta',
    simples_nacional: 'Simples Nacional',
    nao_identificado: 'Não identificado',
  };
  return mapa[regime] ?? regime;
}

/* ─── Skeleton ────────────────────────────────────────────────────────────── */

function Skeleton({ className }: Readonly<{ className?: string }>) {
  return <div className={`animate-pulse rounded bg-muted ${className ?? ''}`} />;
}

function CardSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {[...Array(4)].map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4 space-y-2">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-6 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ─── Config do gráfico ───────────────────────────────────────────────────── */

const CHART_CONFIG: ChartConfig = {
  faturamentoDeclarado:    { label: 'Faturamento Declarado',    color: '#3B82F6' },
  prejuizoFiscalAcumulado: { label: 'Prejuízo Fiscal Acumulado', color: '#EF4444' },
  baseNegativaCsll:        { label: 'Base Negativa CSLL',        color: '#F97316' },
};

/* ─── Gráfico de linhas ──────────────────────────────────────────────────── */

interface ChartDatum {
  ano: string;
  faturamentoDeclarado: number;
  prejuizoFiscalAcumulado: number;
  baseNegativaCsll: number;
}

function GraficoHistorico({ dados }: Readonly<{ dados: EcfIndicador[] }>) {
  const chartData: ChartDatum[] = dados.map(d => ({
    ano:                     String(d.anoCalendario),
    faturamentoDeclarado:    Number(d.faturamentoDeclarado),
    prejuizoFiscalAcumulado: Number(d.prejuizoFiscalAcumulado),
    baseNegativaCsll:        Number(d.baseNegativaCsll),
  }));

  if (chartData.length === 0) return null;

  return (
    <ChartContainer config={CHART_CONFIG} className="h-64 w-full">
      <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="ano"
          tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v: number) => {
            const abs = Math.abs(v);
            if (abs >= 1e9) return `R$ ${(v / 1e9).toFixed(1)}B`;
            if (abs >= 1e6) return `R$ ${(v / 1e6).toFixed(1)}M`;
            if (abs >= 1e3) return `R$ ${(v / 1e3).toFixed(1)}K`;
            return String(v);
          }}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
          width={80}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => fmtBrl(Number(value))}
              labelFormatter={String}
            />
          }
        />
        <Line
          type="monotone"
          dataKey="faturamentoDeclarado"
          name="faturamentoDeclarado"
          stroke="#3B82F6"
          strokeWidth={2}
          dot={{ r: 4, fill: '#3B82F6' }}
          activeDot={{ r: 6 }}
        />
        <Line
          type="monotone"
          dataKey="prejuizoFiscalAcumulado"
          name="prejuizoFiscalAcumulado"
          stroke="#EF4444"
          strokeWidth={2}
          dot={{ r: 4, fill: '#EF4444' }}
          activeDot={{ r: 6 }}
        />
        <Line
          type="monotone"
          dataKey="baseNegativaCsll"
          name="baseNegativaCsll"
          stroke="#F97316"
          strokeWidth={2}
          dot={{ r: 4, fill: '#F97316' }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ChartContainer>
  );
}

/* ─── Legenda do gráfico ─────────────────────────────────────────────────── */

function LegendaGrafico() {
  return (
    <div className="flex flex-wrap gap-4 text-xs">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-blue-500 shrink-0" />
        Faturamento Declarado
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500 shrink-0" />
        Prejuízo Fiscal Acumulado
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-orange-500 shrink-0" />
        Base Negativa CSLL
      </span>
    </div>
  );
}

/* ─── Cards de indicadores ───────────────────────────────────────────────── */

function CardsIndicadores({ ultimo }: Readonly<{ ultimo: EcfIndicador }>) {
  const prejuizo = Number(ultimo.prejuizoFiscalAcumulado);
  const baseNeg  = Number(ultimo.baseNegativaCsll);

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground mb-1">Faturamento Declarado</p>
          <p className="text-lg font-semibold text-foreground break-all">
            {fmtBrl(ultimo.faturamentoDeclarado)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Ano {ultimo.anoCalendario}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground mb-1">Prejuízo Fiscal Acumulado</p>
          <p className={`text-lg font-semibold break-all ${prejuizo > 0 ? 'text-red-600' : 'text-foreground'}`}>
            {fmtBrl(ultimo.prejuizoFiscalAcumulado)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Ano {ultimo.anoCalendario}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground mb-1">Base Negativa de CSLL</p>
          <p className={`text-lg font-semibold break-all ${baseNeg > 0 ? 'text-orange-600' : 'text-foreground'}`}>
            {fmtBrl(ultimo.baseNegativaCsll)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Ano {ultimo.anoCalendario}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground mb-1">Regime Tributário</p>
          <p className="text-base font-semibold text-foreground leading-tight">
            {labelRegime(ultimo.formaTributacao)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{ultimo.razaoSocial}</p>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Tabela histórica ────────────────────────────────────────────────────── */

function TabelaHistorica({ dados }: Readonly<{ dados: EcfIndicador[] }>) {
  if (dados.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Ano</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Regime</th>
            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Faturamento R$</th>
            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Prejuízo Fiscal R$</th>
            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Base Neg. CSLL R$</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Processado em</th>
          </tr>
        </thead>
        <tbody>
          {dados.map((d) => {
            const prejuizo = Number(d.prejuizoFiscalAcumulado);
            const baseNeg  = Number(d.baseNegativaCsll);
            return (
              <tr key={d.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-2.5 font-medium">{d.anoCalendario}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{labelRegime(d.formaTributacao)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmtBrl(d.faturamentoDeclarado)}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${prejuizo > 0 ? 'text-red-600 font-medium' : ''}`}>
                  {fmtBrl(d.prejuizoFiscalAcumulado)}
                </td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${baseNeg > 0 ? 'text-orange-600 font-medium' : ''}`}>
                  {fmtBrl(d.baseNegativaCsll)}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{fmtData(d.processadoEm)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Dashboard principal ─────────────────────────────────────────────────── */

export function IndicadoresEcfDashboard() {
  const { toasts, error: toastError, dismiss } = useToast();

  /* ── Combobox de empresas ── */
  const [empresas, setEmpresas]         = useState<EmpresaComEcf[]>([]);
  const [empresaSearch, setEmpresaSearch] = useState('');
  const [empresaOpen, setEmpresaOpen]   = useState(false);
  const [cnpj, setCnpj]                 = useState('');
  const empresaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    indicadoresEcfApi.empresas().then(setEmpresas).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (empresaRef.current && !empresaRef.current.contains(e.target as Node)) {
        setEmpresaOpen(false);
        setEmpresaSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const empresaSel = cnpj ? empresas.find(e => e.cnpj === cnpj) : null;
  const displayEmpresa = empresaSel ? `${formatarCnpj(empresaSel.cnpj)} — ${empresaSel.razaoSocial}` : '';
  const termo = empresaSearch.replace(/[.\-/]/g, '').toLowerCase();
  const empresasFiltradas = termo
    ? empresas.filter(e =>
        e.cnpj.includes(empresaSearch.replace(/\D/g, '')) ||
        e.razaoSocial.toLowerCase().includes(termo))
    : empresas;

  /* ── Dados ── */
  const [carregando, setCarregando] = useState(false);
  const [dados, setDados]           = useState<EcfIndicador[] | null>(null);

  useEffect(() => {
    if (!cnpj) return;
    setCarregando(true);
    indicadoresEcfApi.individual(cnpj)
      .then(resultado => {
        setDados(resultado);
        if (resultado.length === 0) toastError('Nenhum indicador ECF encontrado para este CNPJ');
      })
      .catch(() => toastError('Erro ao carregar indicadores ECF'))
      .finally(() => setCarregando(false));
  }, [cnpj, toastError]);

  const ultimo = dados && dados.length > 0
    ? [...dados].sort((a, b) => b.anoCalendario - a.anoCalendario)[0]!
    : null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      {/* Cabeçalho */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">Indicadores Fiscais ECF</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Faturamento declarado, prejuízo fiscal e base negativa de CSLL extraídos da ECF
        </p>
      </div>

      {/* Combobox de empresa */}
      <div className="max-w-sm" ref={empresaRef}>
        <div className="relative">
          <input
            type="text"
            autoComplete="off"
            placeholder={empresas.length === 0 ? 'Nenhuma empresa com ECF' : 'Pesquise por CNPJ ou nome…'}
            className="h-9 w-full rounded-md border border-input bg-background px-3 pr-8 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={empresaOpen ? empresaSearch : displayEmpresa}
            onChange={e => { setEmpresaSearch(e.target.value); setEmpresaOpen(true); }}
            onFocus={() => { setEmpresaSearch(''); setEmpresaOpen(true); }}
            disabled={empresas.length === 0}
          />
          {carregando
            ? <ArrowClockwiseIcon size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
            : <CaretDownIcon size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          }
          {empresaOpen && (
            <div className="absolute left-0 top-full mt-1 z-50 w-full min-w-[360px] rounded-md border border-input bg-background shadow-lg max-h-60 overflow-y-auto">
              {empresasFiltradas.length === 0
                ? <p className="px-3 py-2 text-sm text-muted-foreground">Nenhuma empresa encontrada</p>
                : empresasFiltradas.map(emp => (
                    <button
                      type="button"
                      key={emp.cnpj}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-baseline gap-2 ${cnpj === emp.cnpj ? 'bg-primary/5 font-medium' : ''}`}
                      onClick={() => {
                        setCnpj(emp.cnpj);
                        setDados(null);
                        setEmpresaSearch('');
                        setEmpresaOpen(false);
                      }}
                    >
                      <span className="font-mono text-xs text-muted-foreground shrink-0">{formatarCnpj(emp.cnpj)}</span>
                      <span className="text-foreground truncate">{emp.razaoSocial}</span>
                    </button>
                  ))
              }
            </div>
          )}
        </div>
      </div>

      {/* Estado de carregamento */}
      {carregando && <CardSkeleton />}

      {/* Estado vazio inicial */}
      {!carregando && dados === null && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-muted-foreground text-sm">Selecione uma empresa para ver os indicadores.</p>
        </div>
      )}

      {/* Resultados */}
      {!carregando && dados !== null && dados.length > 0 && ultimo && (
        <div className="flex flex-col gap-6">
          <CardsIndicadores ultimo={ultimo} />

          {dados.length > 1 && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Evolução Histórica</p>
                  <p className="text-xs text-muted-foreground">Comparativo anual dos indicadores fiscais</p>
                </div>
                <LegendaGrafico />
                <GraficoHistorico dados={[...dados].sort((a, b) => a.anoCalendario - b.anoCalendario)} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">Histórico Detalhado</p>
              <TabelaHistorica dados={[...dados].sort((a, b) => a.anoCalendario - b.anoCalendario)} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
