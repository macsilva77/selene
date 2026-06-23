'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
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
  type FaturamentoAnual,
  type EmpresaFaturamento,
} from '@/lib/faturamento-api';
import {
  clientesFornecedoresApi,
  type RankingParticipanteRow,
} from '@/lib/clientes-fornecedores-api';

/* ─── Paleta ─────────────────────────────────────────────────────────────── */

const COR_VENDAS  = '#3B5BDB'; // azul  — saídas
const COR_COMPRAS = '#F59F00'; // âmbar — entradas
const COR_VENDAS_CLARO  = '#A5B4F0';
const COR_COMPRAS_CLARO = '#FBD38D';

/* ─── Formatação ─────────────────────────────────────────────────────────── */

function fmtBrl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtMilhoes(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `R$ ${(v / 1e9).toFixed(1)} bi`;
  if (abs >= 1e6) return `R$ ${(v / 1e6).toFixed(1)} mi`;
  if (abs >= 1e3) return `R$ ${(v / 1e3).toFixed(0)} mil`;
  return fmtBrl(v);
}

function fmtPct(v: number): string {
  return `${v.toFixed(0)}%`;
}

function maskCnpj(cnpj: string): string {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

const MESES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

const ANO_CORRENTE = new Date().getFullYear();
const ANOS_DISPONIVEIS = Array.from({ length: 10 }, (_, i) => ANO_CORRENTE - i);

/** % de concentração a partir do qual sinalizamos risco (top-2 participantes). */
const LIMIAR_RISCO = 50;

/* ─── Chart config ───────────────────────────────────────────────────────── */

const CFG_MENSAL: ChartConfig = {
  vendas:  { label: 'Vendas',  color: COR_VENDAS },
  compras: { label: 'Compras', color: COR_COMPRAS },
};

function yTickMilhoes(v: number): string {
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(0)} mi`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)} mil`;
  return String(v);
}

/* ─── Skeleton ───────────────────────────────────────────────────────────── */

function Skeleton({ className }: Readonly<{ className?: string }>) {
  return <div className={`animate-pulse rounded bg-muted ${className ?? ''}`} />;
}

/* ─── Card KPI ───────────────────────────────────────────────────────────── */

function KpiCard({
  label, value, sub, accent,
}: Readonly<{ label: string; value: string; sub?: string; accent?: string }>) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p
          className="text-2xl font-bold tabular-nums leading-tight"
          style={accent ? { color: accent } : undefined}
        >
          {value}
        </p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

/* ─── Lista de concentração (barras horizontais) ─────────────────────────── */

type LinhaConcentracao = { nome: string; pct: number; valor: number; cor: string };

function montarLinhas(
  rows: RankingParticipanteRow[],
  cor: string,
  corClaro: string,
): LinhaConcentracao[] {
  if (rows.length === 0) return [];
  const linhas: LinhaConcentracao[] = rows.map(r => ({
    nome:  r.razaoSocial?.trim() || maskCnpj(r.cnpj.padStart(14, '0')),
    pct:   r.percentual,
    valor: r.valorTotal,
    cor,
  }));
  const acumulado = rows[rows.length - 1]?.acumulado ?? 0;
  const demais = Math.max(0, 100 - acumulado);
  if (demais > 0.05) {
    linhas.push({ nome: 'Demais', pct: demais, valor: 0, cor: corClaro });
  }
  return linhas;
}

function ListaConcentracao({
  titulo, sufixo, linhas, vazioMsg,
}: Readonly<{
  titulo: string;
  sufixo: string;
  linhas: LinhaConcentracao[];
  vazioMsg: string;
}>) {
  const maxPct = Math.max(...linhas.map(l => l.pct), 1);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">
          {titulo}{' '}
          <span className="font-normal text-muted-foreground">({sufixo})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {linhas.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-center text-xs text-muted-foreground border border-dashed border-border rounded-md px-4">
            {vazioMsg}
          </div>
        ) : (
          <ul className="space-y-3">
            {linhas.map((l, i) => (
              <li key={`${l.nome}-${i}`} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 truncate text-muted-foreground" title={l.nome}>
                  {l.nome}
                </span>
                <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${(l.pct / maxPct) * 100}%`, backgroundColor: l.cor }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right tabular-nums font-medium">
                  {fmtPct(l.pct)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── Página ─────────────────────────────────────────────────────────────── */

export default function CadeiaSuprimentoPage() {
  const { toasts, error: toastError, dismiss } = useToast();

  const [empresas, setEmpresas]   = useState<EmpresaFaturamento[]>([]);
  const [empresaId, setEmpresaId] = useState('');
  const [ano, setAno]             = useState(ANO_CORRENTE);

  const [loadingEmpresas, setLoadingEmpresas] = useState(true);
  const [carregando, setCarregando]           = useState(false);

  const [anual, setAnual]         = useState<FaturamentoAnual | null>(null);
  const [clientes, setClientes]   = useState<RankingParticipanteRow[]>([]);
  const [fornecedores, setFornecedores] = useState<RankingParticipanteRow[]>([]);

  const empresaSel = useMemo(
    () => empresas.find(e => e.id === empresaId) ?? null,
    [empresas, empresaId],
  );

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
    if (!empresaSel) return;
    const cnpj = empresaSel.cnpj;
    setCarregando(true);

    const periodo = { cnpj, anoInicio: ano, mesInicio: 1, anoFim: ano, mesFim: 12 };

    Promise.allSettled([
      faturamentoApi.anual({ cnpj, ano, fonte: 'EFD_ICMS' }),
      clientesFornecedoresApi.ranking({ ...periodo, tipo: 'CLIENTE',    topN: 5 }),
      clientesFornecedoresApi.ranking({ ...periodo, tipo: 'FORNECEDOR', topN: 5 }),
    ])
      .then(([rAnual, rCli, rForn]) => {
        setAnual(rAnual.status === 'fulfilled' ? rAnual.value : null);
        setClientes(rCli.status === 'fulfilled' ? rCli.value : []);
        setFornecedores(rForn.status === 'fulfilled' ? rForn.value : []);
        if (rAnual.status === 'rejected' && rCli.status === 'rejected') {
          toastError('Sem dados processados para esta empresa no período.');
        }
      })
      .finally(() => setCarregando(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaSel, ano]);

  useEffect(() => { if (empresaSel) buscar(); }, [empresaSel, ano, buscar]);

  /* ─── Derivados ─── */

  const totalVendas  = anual?.totalFaturamentoBruto ?? 0;
  const totalCompras = anual?.totalComprasBruto ?? 0;
  const saldo        = totalVendas - totalCompras;

  const dadosMensal = useMemo(() => {
    const porMes = new Map(anual?.mensal.map(m => [m.mes, m]) ?? []);
    return Array.from({ length: 12 }, (_, i) => {
      const m = porMes.get(i + 1);
      return {
        label:   MESES[i],
        vendas:  m?.vlFaturamentoBruto ?? 0,
        compras: m?.vlComprasBruto ?? 0,
      };
    });
  }, [anual]);

  const temMensal = dadosMensal.some(d => d.vendas > 0 || d.compras > 0);

  const linhasClientes     = montarLinhas(clientes, COR_VENDAS, COR_VENDAS_CLARO);
  const linhasFornecedores = montarLinhas(fornecedores, COR_COMPRAS, COR_COMPRAS_CLARO);

  const top2Clientes     = clientes.slice(0, 2).reduce((s, r) => s + r.percentual, 0);
  const top2Fornecedores = fornecedores.slice(0, 2).reduce((s, r) => s + r.percentual, 0);

  const temConcentracao = clientes.length > 0 || fornecedores.length > 0;
  const risco = temConcentracao && (top2Clientes >= LIMIAR_RISCO || top2Fornecedores >= LIMIAR_RISCO);
  const dependencia =
    Math.max(top2Clientes, top2Fornecedores) >= 70 ? 'alta dependência'
    : Math.max(top2Clientes, top2Fornecedores) >= 50 ? 'concentração relevante'
    : 'concentração equilibrada';

  /* ─── Render ─── */

  return (
    <div className="flex flex-col gap-5 p-6 max-w-[1440px] mx-auto">

      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cadeia de Suprimento</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Vendas (saídas) × compras (entradas) e concentração de clientes e fornecedores — EFD ICMS/IPI.
          </p>
        </div>
        {risco && (
          <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-900 px-3 py-1.5 text-xs font-semibold border border-amber-300">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            Risco de concentração
          </span>
        )}
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-3">
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
                      {maskCnpj(e.cnpj.padStart(14, '0'))} — {e.nome || e.nomeFantasia || 'Sem razão social'}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label htmlFor="sel-ano" className="text-xs font-medium text-muted-foreground block mb-1">Ano</label>
              <select
                id="sel-ano"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={ano}
                onChange={e => setAno(Number(e.target.value))}
              >
                {ANOS_DISPONIVEIS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      {carregando ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i}><CardContent className="p-4 space-y-2">
              <Skeleton className="h-3 w-1/2" /><Skeleton className="h-7 w-3/4" />
            </CardContent></Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiCard label="Vendas (saídas)"     value={fmtMilhoes(totalVendas)}  sub={fmtBrl(totalVendas)}  accent={COR_VENDAS} />
          <KpiCard label="Compras (entradas)"  value={fmtMilhoes(totalCompras)} sub={fmtBrl(totalCompras)} accent={COR_COMPRAS} />
          <KpiCard
            label="Saldo"
            value={fmtMilhoes(saldo)}
            sub={`${saldo >= 0 ? 'Superávit' : 'Déficit'} no período · ${ano}`}
          />
        </div>
      )}

      {/* Série mensal Vendas × Compras */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Período de vendas e compras <span className="font-normal text-muted-foreground">(R$ / mês · {ano})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {carregando ? (
            <Skeleton className="h-72 w-full" />
          ) : temMensal ? (
            <ChartContainer config={CFG_MENSAL} className="h-72 w-full">
              <BarChart data={dadosMensal} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={yTickMilhoes} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={70} />
                <ChartTooltip content={<ChartTooltipContent formatter={(v) => fmtBrl(Number(v))} labelFormatter={String} />} />
                <Legend wrapperStyle={{ fontSize: 11 }} formatter={(k) => CFG_MENSAL[k]?.label ?? k} />
                <Bar dataKey="vendas"  name="vendas"  fill={COR_VENDAS}  radius={[3,3,0,0]} maxBarSize={26} />
                <Bar dataKey="compras" name="compras" fill={COR_COMPRAS} radius={[3,3,0,0]} maxBarSize={26} />
              </BarChart>
            </ChartContainer>
          ) : (
            <div className="h-72 flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-md">
              Sem faturamento processado para {ano}. Processe o EFD ICMS/IPI em Faturamento.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Concentração */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {carregando ? (
          <>
            <Skeleton className="h-56 w-full" />
            <Skeleton className="h-56 w-full" />
          </>
        ) : (
          <>
            <ListaConcentracao
              titulo="Concentração de clientes"
              sufixo="vendas"
              linhas={linhasClientes}
              vazioMsg="Sem ranking de clientes processado. Gere o Processamento CF para este período."
            />
            <ListaConcentracao
              titulo="Concentração de fornecedores"
              sufixo="compras"
              linhas={linhasFornecedores}
              vazioMsg="Sem ranking de fornecedores processado. Gere o Processamento CF para este período."
            />
          </>
        )}
      </div>

      {/* Alerta de dependência */}
      {!carregando && temConcentracao && (
        <div className={`rounded-lg border px-4 py-3 text-sm flex items-start gap-2.5 ${
          risco
            ? 'bg-amber-50 border-amber-200 text-amber-900'
            : 'bg-muted/50 border-border text-muted-foreground'
        }`}>
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${risco ? 'bg-amber-500' : 'bg-emerald-500'}`} />
          <p>
            {top2Clientes.toFixed(0)}% das vendas vêm dos 2 maiores clientes e{' '}
            {top2Fornecedores.toFixed(0)}% das compras dos 2 maiores fornecedores
            {' — '}{dependencia}.
          </p>
        </div>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
