'use client';

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  MagnifyingGlassIcon,
  ArrowClockwiseIcon,
  UsersThreeIcon,
  BuildingsIcon,
  CaretDownIcon,
} from '@phosphor-icons/react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell } from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Modal } from '@/components/ui/modal';
import { useToast, ToastContainer } from '@/components/ui/toast';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  clientesFornecedoresApi,
  type Competencia,
  type EmpresaComSped,
  type RankingParticipanteRow,
  type RaizRankingRow,
  type DrillDownRow,
  type TipoParticipante,
  type RankingParams,
} from '@/lib/clientes-fornecedores-api';

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function formatarBRL(valor: number) {
  return BRL.format(valor);
}

function formatarCnpj(cnpj: string) {
  if (cnpj.length === 14) {
    return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  if (cnpj.length === 8) {
    return cnpj.replace(/^(\d{2})(\d{3})(\d{3})$/, '$1.$2.$3');
  }
  return cnpj;
}

function formatarPct(valor: number) {
  return `${valor.toFixed(2)}%`;
}

function nomeMes(mes: number) {
  return new Date(2000, mes - 1, 1).toLocaleString('pt-BR', { month: 'short' }).replace('.', '');
}

function labelPeriodo(competencias: Competencia[]): { label: string; value: string }[] {
  return competencias.map(c => ({
    label: `${nomeMes(c.mes).charAt(0).toUpperCase() + nomeMes(c.mes).slice(1)}/${c.ano}`,
    value: `${c.ano}-${String(c.mes).padStart(2, '0')}`,
  }));
}

function parsePeriodo(value: string): { ano: number; mes: number } {
  const [ano, mes] = value.split('-');
  return { ano: Number(ano), mes: Number(mes) };
}

const COR_ABC: Record<string, string> = {
  A: 'hsl(var(--chart-2))',
  B: 'hsl(var(--chart-4))',
  C: 'hsl(var(--chart-1))',
};

const BADGE_ABC: Record<string, string> = {
  A: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  B: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  C: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

function BadgeAbc({ classe }: { classe: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE_ABC[classe] ?? ''}`}>
      {classe}
    </span>
  );
}

type Tab = 'individual' | 'grupo';

const chartConfig = {
  valorTotal: { label: 'Valor Total' },
  A: { label: 'Classe A', color: 'hsl(var(--chart-2))' },
  B: { label: 'Classe B', color: 'hsl(var(--chart-4))' },
  C: { label: 'Classe C', color: 'hsl(var(--chart-1))' },
} satisfies ChartConfig;

/* ─── Sub-componentes ────────────────────────────────────────────────────── */

function TabelaRanking({
  rows,
  carregando,
}: {
  rows: RankingParticipanteRow[];
  carregando: boolean;
}) {
  if (carregando) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Nenhum resultado encontrado.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs font-semibold text-muted-foreground">
            <th className="px-3 py-2.5 w-10 text-center">Pos.</th>
            <th className="px-3 py-2.5">Razão Social</th>
            <th className="px-3 py-2.5">CNPJ</th>
            <th className="px-3 py-2.5 text-right">Valor</th>
            <th className="px-3 py-2.5 text-right">% Part.</th>
            <th className="px-3 py-2.5 text-right">% Acum.</th>
            <th className="px-3 py-2.5 text-right">Qtd Docs</th>
            <th className="px-3 py-2.5 text-center">Classe</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.cnpj}
              className="border-b border-border/60 last:border-0 hover:bg-muted/30 transition-colors"
            >
              <td className="px-3 py-2.5 text-center font-mono text-xs text-muted-foreground">{row.ranking}</td>
              <td className="px-3 py-2.5 font-medium">{row.razaoSocial}</td>
              <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{formatarCnpj(row.cnpj)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatarBRL(row.valorTotal)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatarPct(row.percentual)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatarPct(row.acumulado)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{row.quantidadeDocumentos.toLocaleString('pt-BR')}</td>
              <td className="px-3 py-2.5 text-center"><BadgeAbc classe={row.classeAbc} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabelaGrupo({
  rows,
  carregando,
  onDrillDown,
}: {
  rows: RaizRankingRow[];
  carregando: boolean;
  onDrillDown: (row: RaizRankingRow) => void;
}) {
  if (carregando) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Nenhum resultado encontrado.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs font-semibold text-muted-foreground">
            <th className="px-3 py-2.5 w-10 text-center">Pos.</th>
            <th className="px-3 py-2.5">Razão Social</th>
            <th className="px-3 py-2.5">Raiz CNPJ</th>
            <th className="px-3 py-2.5 text-right">Valor</th>
            <th className="px-3 py-2.5 text-right">% Part.</th>
            <th className="px-3 py-2.5 text-right">% Acum.</th>
            <th className="px-3 py-2.5 text-right">Qtd CNPJs</th>
            <th className="px-3 py-2.5 text-center">Classe</th>
            <th className="px-3 py-2.5 w-10"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.cnpjRaiz}
              className="border-b border-border/60 last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
              onClick={() => onDrillDown(row)}
            >
              <td className="px-3 py-2.5 text-center font-mono text-xs text-muted-foreground">{row.ranking}</td>
              <td className="px-3 py-2.5 font-medium">{row.razaoSocial}</td>
              <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{formatarCnpj(row.cnpjRaiz)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatarBRL(row.valorTotal)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatarPct(row.percentual)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatarPct(row.acumulado)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{row.qtdCnpjs}</td>
              <td className="px-3 py-2.5 text-center"><BadgeAbc classe={row.classeAbc} /></td>
              <td className="px-3 py-2.5 text-muted-foreground">
                <CaretDownIcon size={12} className="-rotate-90" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabelaDrillDown({ rows }: { rows: DrillDownRow[] }) {
  if (rows.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">Nenhum CNPJ encontrado.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs font-semibold text-muted-foreground">
            <th className="px-3 py-2.5">Razão Social</th>
            <th className="px-3 py-2.5">CNPJ</th>
            <th className="px-3 py-2.5 text-right">Valor</th>
            <th className="px-3 py-2.5 text-right">% Grupo</th>
            <th className="px-3 py-2.5 text-right">Qtd Docs</th>
            <th className="px-3 py-2.5 text-center">Matriz</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.cnpj}
              className="border-b border-border/60 last:border-0 hover:bg-muted/30 transition-colors"
            >
              <td className="px-3 py-2.5 font-medium">{row.razaoSocial}</td>
              <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{formatarCnpj(row.cnpj)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatarBRL(row.valorTotal)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatarPct(row.percentualGrupo)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{row.quantidadeDocumentos.toLocaleString('pt-BR')}</td>
              <td className="px-3 py-2.5 text-center">
                {row.isMatriz && (
                  <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    Matriz
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Gráfico horizontal top-10 ─────────────────────────────────────────── */

function GraficoTop10({ rows }: { rows: RankingParticipanteRow[] }) {
  const top10 = useMemo(
    () =>
      rows.slice(0, 10).map(r => ({
        nome: r.razaoSocial.length > 30 ? r.razaoSocial.slice(0, 28) + '…' : r.razaoSocial,
        valorTotal: r.valorTotal,
        classeAbc: r.classeAbc,
      })),
    [rows],
  );

  if (top10.length === 0) return null;

  return (
    <Card className="border">
      <CardContent className="p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top 10 por Valor Total</p>
        <ChartContainer config={chartConfig} className="h-64 w-full">
          <BarChart
            data={top10}
            layout="vertical"
            margin={{ top: 0, right: 16, bottom: 0, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(v: number) => BRL.format(v)}
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="category"
              dataKey="nome"
              width={160}
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) =>
                    typeof value === 'number' ? formatarBRL(value) : String(value)
                  }
                />
              }
            />
            <Bar dataKey="valorTotal" radius={[0, 4, 4, 0]}>
              {top10.map((entry, index) => (
                <Cell key={index} fill={COR_ABC[entry.classeAbc] ?? COR_ABC['C']} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>

        {/* Legenda manual ABC */}
        <div className="mt-2 flex items-center gap-4 justify-center">
          {(['A', 'B', 'C'] as const).map(cls => (
            <div key={cls} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: COR_ABC[cls] }}
              />
              Classe {cls}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Componente principal ───────────────────────────────────────────────── */

export function ClientesFornecedoresDashboard() {
  const { toasts, error: toastError, dismiss } = useToast();

  /* ── Lista de empresas com SPEDs ── */
  const [empresas, setEmpresas]         = useState<EmpresaComSped[]>([]);
  const [empresaSearch, setEmpresaSearch] = useState('');
  const [empresaOpen, setEmpresaOpen]   = useState(false);
  const empresaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    clientesFornecedoresApi.empresas().then(setEmpresas).catch(() => {});
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

  /* ── Estado dos filtros ── */
  const [cnpj, setCnpj]                   = useState('');
  const [competencias, setCompetencias]   = useState<Competencia[]>([]);
  const [periodoInicio, setPeriodoInicio] = useState('');
  const [periodoFim, setPeriodoFim]       = useState('');
  const [tipo, setTipo]                   = useState<TipoParticipante>('CLIENTE');
  const [topN, setTopN]                   = useState(20);
  const [tab, setTab]                     = useState<Tab>('individual');

  /* ── Estado de dados ── */
  const [ranking, setRanking]     = useState<RankingParticipanteRow[]>([]);
  const [porRaiz, setPorRaiz]     = useState<RaizRankingRow[]>([]);

  /* ── Loading states ── */
  const [carregandoComp, setCarregandoComp]     = useState(false);
  const [carregandoRank, setCarregandoRank]     = useState(false);
  const [carregandoGrupo, setCarregandoGrupo]   = useState(false);
  const [buscandoCnpj, setBuscandoCnpj]         = useState(false);

  /* ── Busca por CNPJ participante ── */
  const [cnpjParticipante, setCnpjParticipante]   = useState('');
  const [resultadoCnpj, setResultadoCnpj]         = useState<RankingParticipanteRow[]>([]);

  /* ── Drill-down ── */
  const [drilldownAberto, setDrilldownAberto]   = useState(false);
  const [drilldownGrupo, setDrilldownGrupo]     = useState<RaizRankingRow | null>(null);
  const [drilldownRows, setDrilldownRows]       = useState<DrillDownRow[]>([]);
  const [carregandoDrill, setCarregandoDrill]   = useState(false);

  /* ── Opções de período derivadas das competências ── */
  const opcoesPeriodo = useMemo(() => labelPeriodo(competencias), [competencias]);

  /* ── Empresa selecionada e filtro do combobox ── */
  const empresaSelecionada = cnpj ? empresas.find(e => e.cnpj === cnpj) : null;
  const displayEmpresa     = empresaSelecionada
    ? `${formatarCnpj(empresaSelecionada.cnpj)} — ${empresaSelecionada.razaoSocial}`
    : '';
  const termo = empresaSearch.replace(/[.\-/]/g, '').toLowerCase();
  const empresasFiltradas = termo
    ? empresas.filter(e => {
        const cnpjNorm = e.cnpj.replace(/[.\-/]/g, '').toLowerCase();
        const nome = e.razaoSocial.toLowerCase();
        return cnpjNorm.includes(termo) || nome.includes(termo);
      })
    : empresas;

  /* ── Carregar competências ao selecionar empresa ── */
  const carregarCompetencias = useCallback(async (cnpjValor: string) => {
    if (!cnpjValor || cnpjValor.length < 14) return;
    setCarregandoComp(true);
    setCompetencias([]);
    setPeriodoInicio('');
    setPeriodoFim('');
    setRanking([]);
    setPorRaiz([]);
    try {
      const data = await clientesFornecedoresApi.competencias(cnpjValor);
      setCompetencias(data);
      if (data.length > 0) {
        const primeiro = data[0];
        const ultimo   = data[data.length - 1];
        setPeriodoInicio(`${primeiro.ano}-${String(primeiro.mes).padStart(2, '0')}`);
        setPeriodoFim(`${ultimo.ano}-${String(ultimo.mes).padStart(2, '0')}`);
      }
    } catch {
      toastError('Erro ao carregar competências disponíveis');
    } finally {
      setCarregandoComp(false);
    }
  }, [toastError]);

  /* ── Buscar ranking ── */
  const buscar = useCallback(async () => {
    if (!cnpj || !periodoInicio || !periodoFim) return;

    const inicio = parsePeriodo(periodoInicio);
    const fim = parsePeriodo(periodoFim);
    const baseParams = {
      cnpj: cnpj.replace(/\D/g, ''),
      anoInicio: inicio.ano,
      mesInicio: inicio.mes,
      anoFim: fim.ano,
      mesFim: fim.mes,
      tipo,
    };

    setRanking([]);
    setPorRaiz([]);
    setResultadoCnpj([]);

    if (tab === 'individual') {
      setCarregandoRank(true);
      try {
        const params: RankingParams = { ...baseParams, topN };
        const data = await clientesFornecedoresApi.ranking(params);
        setRanking(data);
      } catch {
        toastError('Erro ao buscar ranking');
      } finally {
        setCarregandoRank(false);
      }
    } else {
      setCarregandoGrupo(true);
      try {
        const data = await clientesFornecedoresApi.porRaiz(baseParams);
        setPorRaiz(data);
      } catch {
        toastError('Erro ao buscar ranking por grupo econômico');
      } finally {
        setCarregandoGrupo(false);
      }
    }
  }, [cnpj, periodoInicio, periodoFim, tipo, topN, tab, toastError]);

  /* ── Auto-busca quando empresa e período estão definidos ── */
  useEffect(() => {
    if (cnpj && periodoInicio && periodoFim) void buscar();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cnpj, periodoInicio, periodoFim, tipo]);

  /* ── Drill-down de grupo econômico ── */
  const abrirDrillDown = useCallback(async (row: RaizRankingRow) => {
    if (!cnpj || !periodoInicio || !periodoFim) return;
    setDrilldownGrupo(row);
    setDrilldownRows([]);
    setDrilldownAberto(true);
    setCarregandoDrill(true);
    const inicio = parsePeriodo(periodoInicio);
    const fim = parsePeriodo(periodoFim);
    try {
      const data = await clientesFornecedoresApi.drillDown({
        cnpj: cnpj.replace(/\D/g, ''),
        anoInicio: inicio.ano,
        mesInicio: inicio.mes,
        anoFim: fim.ano,
        mesFim: fim.mes,
        tipo,
        cnpjRaiz: row.cnpjRaiz,
      });
      setDrilldownRows(data);
    } catch {
      toastError('Erro ao carregar detalhes do grupo econômico');
    } finally {
      setCarregandoDrill(false);
    }
  }, [cnpj, periodoInicio, periodoFim, tipo, toastError]);

  /* ── Busca por CNPJ participante ── */
  const buscarPorCnpj = useCallback(async () => {
    const cnpjLimpo = cnpjParticipante.replace(/\D/g, '');
    if (!cnpj || !periodoInicio || !periodoFim) {
      toastError('Preencha o CNPJ da empresa e o período antes de buscar');
      return;
    }
    if (cnpjLimpo.length < 8) {
      toastError('Informe ao menos os 8 primeiros dígitos do CNPJ do participante');
      return;
    }
    const inicio = parsePeriodo(periodoInicio);
    const fim = parsePeriodo(periodoFim);
    setBuscandoCnpj(true);
    setResultadoCnpj([]);
    try {
      const data = await clientesFornecedoresApi.porCnpj({
        cnpj: cnpj.replace(/\D/g, ''),
        anoInicio: inicio.ano,
        mesInicio: inicio.mes,
        anoFim: fim.ano,
        mesFim: fim.mes,
        tipo,
        cnpjParticipante: cnpjLimpo,
      });
      setResultadoCnpj(data);
      if (data.length === 0) toastError('Participante não encontrado no período');
    } catch {
      toastError('Erro ao buscar participante por CNPJ');
    } finally {
      setBuscandoCnpj(false);
    }
  }, [cnpj, periodoInicio, periodoFim, tipo, cnpjParticipante, toastError]);

  const carregandoPrincipal = carregandoRank || carregandoGrupo;
  const hasData = tab === 'individual' ? ranking.length > 0 : porRaiz.length > 0;

  return (
    <div className="flex flex-col gap-4 p-6">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      {/* ── Cabeçalho ── */}
      <div className="flex items-center gap-3">
        <UsersThreeIcon size={24} className="text-primary shrink-0" />
        <div>
          <h1 className="text-xl font-semibold">Clientes e Fornecedores</h1>
          <p className="text-sm text-muted-foreground">Análise ABC de participantes por período</p>
        </div>
      </div>

      {/* ── Filtros ── */}
      <Card className="border">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">

            {/* Empresa (combobox) */}
            <div className="flex flex-col gap-1 lg:col-span-1" ref={empresaRef}>
              <label className="text-xs font-medium text-muted-foreground">
                Empresa
              </label>
              <div className="relative">
                <input
                  type="text"
                  autoComplete="off"
                  placeholder={empresas.length === 0 ? 'Nenhuma empresa com SPED' : 'Pesquise por CNPJ ou nome…'}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  value={empresaOpen ? empresaSearch : displayEmpresa}
                  onChange={e => { setEmpresaSearch(e.target.value); setEmpresaOpen(true); }}
                  onFocus={() => { setEmpresaSearch(''); setEmpresaOpen(true); }}
                  disabled={empresas.length === 0}
                />
                {carregandoComp
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
                              setEmpresaSearch('');
                              setEmpresaOpen(false);
                              void carregarCompetencias(emp.cnpj);
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

            {/* Período início */}
            <div className="flex flex-col gap-1">
              <label htmlFor="sel-inicio" className="text-xs font-medium text-muted-foreground">
                Período início
              </label>
              <select
                id="sel-inicio"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                value={periodoInicio}
                onChange={e => setPeriodoInicio(e.target.value)}
                disabled={opcoesPeriodo.length === 0}
              >
                <option value="">Selecione…</option>
                {opcoesPeriodo.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Período fim */}
            <div className="flex flex-col gap-1">
              <label htmlFor="sel-fim" className="text-xs font-medium text-muted-foreground">
                Período fim
              </label>
              <select
                id="sel-fim"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                value={periodoFim}
                onChange={e => setPeriodoFim(e.target.value)}
                disabled={opcoesPeriodo.length === 0}
              >
                <option value="">Selecione…</option>
                {opcoesPeriodo.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Top N */}
            <div className="flex flex-col gap-1">
              <label htmlFor="inp-topn" className="text-xs font-medium text-muted-foreground">
                Top N (5–100) — atual: {topN}
              </label>
              <input
                id="inp-topn"
                type="range"
                min={5}
                max={100}
                step={5}
                value={topN}
                onChange={e => setTopN(Number(e.target.value))}
                className="h-9 w-full accent-primary"
              />
            </div>
          </div>

          {/* Toggle tipo + botão buscar */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {/* Tipo */}
            <div className="flex rounded-md border border-input overflow-hidden">
              {(['CLIENTE', 'FORNECEDOR'] as TipoParticipante[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipo(t)}
                  className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                    tipo === t
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {t === 'CLIENTE' ? 'Clientes' : 'Fornecedores'}
                </button>
              ))}
            </div>

            {/* Buscar */}
            <button
              type="button"
              onClick={buscar}
              disabled={carregandoPrincipal || !cnpj || !periodoInicio || !periodoFim}
              className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <MagnifyingGlassIcon size={14} className={carregandoPrincipal ? 'animate-spin' : ''} />
              {carregandoPrincipal ? 'Buscando…' : 'Buscar'}
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ── Tabs individual / grupo ── */}
      {(hasData || carregandoPrincipal) && (
        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">

          {/* Sub-header com tabs */}
          <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-6 py-3">
            {([
              { id: 'individual' as Tab, label: 'Ranking Individual' },
              { id: 'grupo' as Tab, label: 'Por Grupo Econômico' },
            ]).map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-4 p-4">
            {/* Gráfico top 10 (apenas aba individual) */}
            {tab === 'individual' && ranking.length > 0 && (
              <GraficoTop10 rows={ranking} />
            )}

            {/* Tabelas */}
            {tab === 'individual' && (
              <TabelaRanking rows={ranking} carregando={carregandoRank} />
            )}
            {tab === 'grupo' && (
              <TabelaGrupo rows={porRaiz} carregando={carregandoGrupo} onDrillDown={abrirDrillDown} />
            )}
          </div>
        </div>
      )}

      {/* ── Busca por CNPJ participante ── */}
      <Card className="border">
        <CardContent className="p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Buscar Participante por CNPJ
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="CNPJ ou raiz (8–14 dígitos)"
              maxLength={18}
              value={cnpjParticipante}
              onChange={e => setCnpjParticipante(e.target.value)}
              className="h-9 flex-1 min-w-[200px] rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              onClick={buscarPorCnpj}
              disabled={buscandoCnpj || !cnpjParticipante}
              className="flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50 transition-colors"
            >
              <MagnifyingGlassIcon size={14} className={buscandoCnpj ? 'animate-spin' : ''} />
              {buscandoCnpj ? 'Buscando…' : 'Localizar'}
            </button>
          </div>

          {resultadoCnpj.length > 0 && (
            <div className="mt-4">
              <TabelaRanking rows={resultadoCnpj} carregando={false} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Estado vazio inicial ── */}
      {!hasData && !carregandoPrincipal && ranking.length === 0 && porRaiz.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
          <BuildingsIcon size={40} />
          <p className="text-sm">Informe o CNPJ da empresa e o período para iniciar a análise</p>
        </div>
      )}

      {/* ── Dialog drill-down grupo econômico ── */}
      <Modal
        isOpen={drilldownAberto}
        onClose={() => setDrilldownAberto(false)}
        title={drilldownGrupo ? `Grupo: ${drilldownGrupo.razaoSocial}` : 'Grupo Econômico'}
        subtitle={drilldownGrupo ? `Raiz CNPJ: ${formatarCnpj(drilldownGrupo.cnpjRaiz)} · ${drilldownGrupo.qtdCnpjs} CNPJ(s)` : undefined}
        size="3xl"
      >
        {carregandoDrill ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <TabelaDrillDown rows={drilldownRows} />
        )}
      </Modal>
    </div>
  );
}
