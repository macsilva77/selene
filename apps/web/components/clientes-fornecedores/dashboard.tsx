'use client';

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  MagnifyingGlassIcon,
  ArrowClockwiseIcon,
  ArrowsClockwiseIcon,
  UsersThreeIcon,
  BuildingsIcon,
  CaretDownIcon,
  DownloadSimpleIcon,
} from '@phosphor-icons/react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, LabelList } from 'recharts';
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
} from '@/lib/clientes-fornecedores-api';

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function formatarBRL(v: number) { return BRL.format(v); }

function formatarCnpj(cnpj: string) {
  if (cnpj.length === 14) return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (cnpj.length === 8)  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})$/, '$1.$2.$3');
  return cnpj;
}

function formatarPct(v: number) { return `${v.toFixed(2)}%`; }

function labelMes(mes: number) {
  const s = new Date(2000, mes - 1, 1).toLocaleString('pt-BR', { month: 'short' }).replace('.', '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parsePeriodo(value: string) {
  const [ano, mes] = value.split('-');
  return { ano: Number(ano), mes: Number(mes) };
}

function periodosPorAno(competencias: Competencia[]) {
  const map = new Map<number, { label: string; value: string }[]>();
  for (const c of competencias) {
    if (!map.has(c.ano)) map.set(c.ano, []);
    map.get(c.ano)!.push({
      label: `${labelMes(c.mes)}/${c.ano}`,
      value: `${c.ano}-${String(c.mes).padStart(2, '0')}`,
    });
  }
  return [...map.entries()].sort(([a], [b]) => a - b);
}

/* Cores hardcoded para funcionar como atributo fill em SVG (CSS var não funciona em SVG presentation attributes) */
const COR_ABC: Record<string, string> = {
  A: '#10b981',  // emerald-500 — classe dominante
  B: '#f59e0b',  // amber-500 — classe intermediária
  C: '#f87171',  // red-400 — classe menor
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

/* ─── Seletor de período: dois selects (ano + mês) ──────────────────────── */

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function PeriodSelect({
  label, value, onChange, competencias, disabled,
}: {
  label: string; value: string;
  onChange: (v: string) => void;
  competencias: Competencia[]; disabled?: boolean;
}) {
  const partes   = value ? value.split('-') : [];
  const anoAtual = partes[0] ? Number(partes[0]) : 0;
  const mesAtual = partes[1] ? Number(partes[1]) : 0;

  const anos = useMemo(
    () => [...new Set(competencias.map(c => c.ano))].sort((a, b) => a - b),
    [competencias],
  );
  const meses = useMemo(
    () => competencias.filter(c => c.ano === anoAtual).map(c => c.mes).sort((a, b) => a - b),
    [competencias, anoAtual],
  );

  const cls = 'h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50';

  const handleAno = (novoAno: number) => {
    const primeiro = competencias.filter(c => c.ano === novoAno).sort((a, b) => a.mes - b.mes)[0];
    if (primeiro) onChange(`${novoAno}-${String(primeiro.mes).padStart(2, '0')}`);
  };

  const handleMes = (novoMes: number) => {
    if (anoAtual) onChange(`${anoAtual}-${String(novoMes).padStart(2, '0')}`);
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex gap-1.5">
        <select
          aria-label={`${label} — ano`}
          value={anoAtual || ''}
          onChange={e => handleAno(Number(e.target.value))}
          disabled={disabled || anos.length === 0}
          className={`${cls} flex-none w-[72px]`}
        >
          <option value="">Ano</option>
          {anos.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          aria-label={`${label} — mês`}
          value={mesAtual || ''}
          onChange={e => handleMes(Number(e.target.value))}
          disabled={disabled || !anoAtual || meses.length === 0}
          className={`${cls} flex-1`}
        >
          <option value="">Mês</option>
          {meses.map(m => <option key={m} value={m}>{MESES[m - 1]}</option>)}
        </select>
      </div>
    </div>
  );
}

/* ─── Gráfico de barras ABC (individual e grupo) ─────────────────────────── */

interface GraficoRow { razaoSocial: string; valorTotal: number; classeAbc: string; }

function GraficoBarras({ rows, titulo }: { rows: GraficoRow[]; titulo: string }) {
  const data = useMemo(
    () => rows.slice(0, 10).map(r => ({
      nome: r.razaoSocial.length > 24 ? r.razaoSocial.slice(0, 22) + '…' : r.razaoSocial,
      valorTotal: r.valorTotal,
      classeAbc: r.classeAbc,
    })),
    [rows],
  );
  if (data.length === 0) return null;

  const altura = data.length <= 5 ? 'h-52' : data.length <= 7 ? 'h-64' : 'h-80';

  return (
    <Card className="border">
      <CardContent className="p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</p>
        <ChartContainer config={chartConfig} className={`${altura} w-full`}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 140, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
            <XAxis
              type="number"
              tickFormatter={(v: number) =>
                v >= 1_000_000 ? `R$ ${(v / 1_000_000).toFixed(1)}M`
                : v >= 1_000 ? `R$ ${(v / 1_000).toFixed(0)}k`
                : `R$ ${v.toFixed(0)}`
              }
              tick={{ fontSize: 9 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="category"
              dataKey="nome"
              width={148}
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => typeof value === 'number' ? formatarBRL(value) : String(value)}
                />
              }
            />
            <Bar dataKey="valorTotal" radius={[0, 4, 4, 0]} maxBarSize={28}>
              <LabelList
                dataKey="valorTotal"
                position="right"
                formatter={(v) => typeof v === 'number' ? formatarBRL(v) : String(v)}
                className="fill-muted-foreground text-[9px]"
              />
              {data.map((entry, i) => (
                <Cell key={i} fill={COR_ABC[entry.classeAbc] ?? COR_ABC['C']} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
        <div className="mt-3 flex items-center gap-6 justify-center">
          {(['A', 'B', 'C'] as const).map(cls => (
            <div key={cls} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ backgroundColor: COR_ABC[cls] }}
              />
              <span>Classe <strong className="text-foreground">{cls}</strong></span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Tabelas ────────────────────────────────────────────────────────────── */

function TabelaRanking({ rows, carregando }: { rows: RankingParticipanteRow[]; carregando: boolean }) {
  if (carregando) return <div className="flex flex-col gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">Nenhum resultado encontrado.</p>;
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
          {rows.map(row => (
            <tr key={row.cnpj} className="border-b border-border/60 last:border-0 hover:bg-muted/30 transition-colors">
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
  rows, carregando, onDrillDown,
}: { rows: RaizRankingRow[]; carregando: boolean; onDrillDown: (r: RaizRankingRow) => void }) {
  if (carregando) return <div className="flex flex-col gap-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">Nenhum resultado encontrado.</p>;
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
            <th className="px-3 py-2.5 w-6" aria-label="Expandir"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.cnpjRaiz} className="border-b border-border/60 last:border-0 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => onDrillDown(row)}>
              <td className="px-3 py-2.5 text-center font-mono text-xs text-muted-foreground">{row.ranking}</td>
              <td className="px-3 py-2.5 font-medium">{row.razaoSocial}</td>
              <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{formatarCnpj(row.cnpjRaiz)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatarBRL(row.valorTotal)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatarPct(row.percentual)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatarPct(row.acumulado)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{row.qtdCnpjs}</td>
              <td className="px-3 py-2.5 text-center"><BadgeAbc classe={row.classeAbc} /></td>
              <td className="px-3 py-2.5 text-muted-foreground"><CaretDownIcon size={12} className="-rotate-90" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabelaDrillDown({ rows }: { rows: DrillDownRow[] }) {
  if (rows.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground">Nenhum CNPJ encontrado.</p>;
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
          {rows.map(row => (
            <tr key={row.cnpj} className="border-b border-border/60 last:border-0 hover:bg-muted/30 transition-colors">
              <td className="px-3 py-2.5 font-medium">{row.razaoSocial}</td>
              <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{formatarCnpj(row.cnpj)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatarBRL(row.valorTotal)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatarPct(row.percentualGrupo)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{row.quantidadeDocumentos.toLocaleString('pt-BR')}</td>
              <td className="px-3 py-2.5 text-center">
                {row.isMatriz && <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Matriz</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Componente principal ───────────────────────────────────────────────── */

export function ClientesFornecedoresDashboard() {
  const { toasts, error: toastError, success: toastSuccess, dismiss } = useToast();

  /* ── Empresas ── */
  const [empresas, setEmpresas]           = useState<EmpresaComSped[]>([]);
  const [empresaSearch, setEmpresaSearch] = useState('');
  const [empresaOpen, setEmpresaOpen]     = useState(false);
  const empresaRef = useRef<HTMLDivElement>(null);
  const [reprocessando, setReprocessando] = useState(false);
  const [exportando, setExportando]       = useState(false);

  const carregarEmpresas = useCallback(() => {
    clientesFornecedoresApi.empresas()
      .then(setEmpresas)
      .catch(() => toastError('Erro ao carregar lista de empresas'));
  }, [toastError]);

  useEffect(() => { carregarEmpresas(); }, [carregarEmpresas]);

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

  const reprocessarSped = useCallback(async () => {
    if (reprocessando) return;
    setReprocessando(true);
    try {
      const res = await clientesFornecedoresApi.reprocessar();
      toastSuccess(`${res.mensagem} — aguarde o processamento em background`);
      setTimeout(() => carregarEmpresas(), 5000);
    } catch {
      toastError('Erro ao iniciar reprocessamento');
    } finally {
      setReprocessando(false);
    }
  }, [reprocessando, carregarEmpresas, toastSuccess, toastError]);

  /* ── Filtros ── */
  const [cnpj, setCnpj]                   = useState('');
  const [competencias, setCompetencias]   = useState<Competencia[]>([]);
  const [periodoInicio, setPeriodoInicio] = useState('');
  const [periodoFim, setPeriodoFim]       = useState('');
  const [tipo, setTipo]                   = useState<TipoParticipante>('CLIENTE');
  const [topN, setTopN]                   = useState(10);
  const [tab, setTab]                     = useState<Tab>('individual');
  const [busca, setBusca]                 = useState('');

  /* ── Dados ── */
  const [ranking, setRanking] = useState<RankingParticipanteRow[]>([]);
  const [porRaiz, setPorRaiz] = useState<RaizRankingRow[]>([]);

  /* ── Loading ── */
  const [carregandoComp, setCarregandoComp]   = useState(false);
  const [carregandoRank, setCarregandoRank]   = useState(false);
  const [carregandoGrupo, setCarregandoGrupo] = useState(false);

  /* ── Drill-down ── */
  const [drilldownAberto, setDrilldownAberto] = useState(false);
  const [drilldownGrupo, setDrilldownGrupo]   = useState<RaizRankingRow | null>(null);
  const [drilldownRows, setDrilldownRows]     = useState<DrillDownRow[]>([]);
  const [carregandoDrill, setCarregandoDrill] = useState(false);

  /* ── Empresa selecionada ── */
  const empresaSelecionada = cnpj ? empresas.find(e => e.cnpj === cnpj) : null;
  const displayEmpresa = empresaSelecionada
    ? `${formatarCnpj(empresaSelecionada.cnpj)} — ${empresaSelecionada.razaoSocial}`
    : '';
  const termo = empresaSearch.replace(/[.\-/]/g, '').toLowerCase();
  const empresasFiltradas = termo
    ? empresas.filter(e => {
        const c = e.cnpj.replace(/[.\-/]/g, '').toLowerCase();
        return c.includes(termo) || e.razaoSocial.toLowerCase().includes(termo);
      })
    : empresas;

  /* ── Filtro de busca inline nos dados carregados ── */
  const termoBusca = busca.trim().toLowerCase();
  const cnpjBusca  = busca.replace(/\D/g, '');

  const rankingFiltrado = useMemo(() => {
    if (!termoBusca) return ranking;
    return ranking.filter(r =>
      r.razaoSocial.toLowerCase().includes(termoBusca) ||
      (cnpjBusca.length >= 4 && r.cnpj.includes(cnpjBusca)),
    );
  }, [ranking, termoBusca, cnpjBusca]);

  const raizFiltrado = useMemo(() => {
    if (!termoBusca) return porRaiz;
    return porRaiz.filter(r =>
      r.razaoSocial.toLowerCase().includes(termoBusca) ||
      (cnpjBusca.length >= 4 && r.cnpjRaiz.includes(cnpjBusca)),
    );
  }, [porRaiz, termoBusca, cnpjBusca]);

  /* ── Carregar competências ao selecionar empresa ── */
  const carregarCompetencias = useCallback(async (cnpjValor: string) => {
    if (!cnpjValor || cnpjValor.length < 14) return;
    setCarregandoComp(true);
    setCompetencias([]);
    setPeriodoInicio('');
    setPeriodoFim('');
    setRanking([]);
    setPorRaiz([]);
    setBusca('');
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
    const fim    = parsePeriodo(periodoFim);
    const base   = {
      cnpj:      cnpj.replace(/\D/g, ''),
      anoInicio: inicio.ano,
      mesInicio: inicio.mes,
      anoFim:    fim.ano,
      mesFim:    fim.mes,
      tipo,
    };

    setRanking([]);
    setPorRaiz([]);
    setBusca('');

    if (tab === 'individual') {
      setCarregandoRank(true);
      try {
        const data = await clientesFornecedoresApi.ranking({ ...base, topN });
        setRanking(data);
      } catch {
        toastError('Erro ao buscar ranking');
      } finally {
        setCarregandoRank(false);
      }
    } else {
      setCarregandoGrupo(true);
      try {
        const data = await clientesFornecedoresApi.porRaiz(base);
        setPorRaiz(data);
      } catch {
        toastError('Erro ao buscar ranking por grupo econômico');
      } finally {
        setCarregandoGrupo(false);
      }
    }
  }, [cnpj, periodoInicio, periodoFim, tipo, topN, tab, toastError]);

  /* ── Ref para evitar stale closure no auto-busca ── */
  const buscarRef = useRef(buscar);
  useEffect(() => { buscarRef.current = buscar; });

  /* ── Auto-busca quando empresa/período/tipo/tab mudam ── */
  useEffect(() => {
    if (cnpj && periodoInicio && periodoFim) void buscarRef.current();
  }, [cnpj, periodoInicio, periodoFim, tipo, tab]);

  /* ── Exportar Excel ── */
  const exportarExcel = useCallback(async () => {
    if (!cnpj || !periodoInicio || !periodoFim || exportando) return;
    setExportando(true);
    try {
      const inicio = parsePeriodo(periodoInicio);
      const fim    = parsePeriodo(periodoFim);
      const blob   = await clientesFornecedoresApi.exportar({
        cnpj:      cnpj.replace(/\D/g, ''),
        anoInicio: inicio.ano,
        mesInicio: inicio.mes,
        anoFim:    fim.ano,
        mesFim:    fim.mes,
        tipo,
      });
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = 'clientes-fornecedores.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toastError('Erro ao exportar planilha');
    } finally {
      setExportando(false);
    }
  }, [cnpj, periodoInicio, periodoFim, tipo, exportando, toastError]);

  /* ── Drill-down grupo econômico ── */
  const abrirDrillDown = useCallback(async (row: RaizRankingRow) => {
    if (!cnpj || !periodoInicio || !periodoFim) return;
    setDrilldownGrupo(row);
    setDrilldownRows([]);
    setDrilldownAberto(true);
    setCarregandoDrill(true);
    const inicio = parsePeriodo(periodoInicio);
    const fim    = parsePeriodo(periodoFim);
    try {
      const data = await clientesFornecedoresApi.drillDown({
        cnpj:      cnpj.replace(/\D/g, ''),
        anoInicio: inicio.ano,
        mesInicio: inicio.mes,
        anoFim:    fim.ano,
        mesFim:    fim.mes,
        tipo,
        cnpjRaiz:  row.cnpjRaiz,
      });
      setDrilldownRows(data);
    } catch {
      toastError('Erro ao carregar detalhes do grupo econômico');
    } finally {
      setCarregandoDrill(false);
    }
  }, [cnpj, periodoInicio, periodoFim, tipo, toastError]);

  const carregandoPrincipal = carregandoRank || carregandoGrupo;
  const hasData = tab === 'individual' ? ranking.length > 0 : porRaiz.length > 0;

  /* ── Dados do gráfico (aba ativa) ── */
  const dadosGrafico: GraficoRow[] = tab === 'individual'
    ? rankingFiltrado
    : raizFiltrado;

  const tituloGrafico = tab === 'individual'
    ? `Top ${Math.min(rankingFiltrado.length, 10)} por Valor Total`
    : `Top ${Math.min(raizFiltrado.length, 10)} Grupos por Valor Total`;

  return (
    <div className="flex flex-col gap-4 p-6">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      {/* ── Cabeçalho ── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <UsersThreeIcon size={24} className="text-primary shrink-0" />
          <div>
            <h1 className="text-xl font-semibold">Clientes e Fornecedores</h1>
            <p className="text-sm text-muted-foreground">Análise ABC de participantes por período</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {cnpj && periodoInicio && periodoFim && (
            <button
              type="button"
              onClick={() => void exportarExcel()}
              disabled={exportando}
              title="Exportar ranking para Excel"
              className="flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50 transition-colors"
            >
              <DownloadSimpleIcon size={13} className={exportando ? 'animate-pulse' : ''} />
              {exportando ? 'Exportando…' : 'Exportar Excel'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void reprocessarSped()}
            disabled={reprocessando}
            title="Reprocessa todos os SPEDs EFD disponíveis"
            className="flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50 transition-colors"
          >
            <ArrowsClockwiseIcon size={13} className={reprocessando ? 'animate-spin' : ''} />
            {reprocessando ? 'Reprocessando…' : 'Reprocessar SPED'}
          </button>
        </div>
      </div>

      {/* ── Filtros ── */}
      <Card className="border">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">

            {/* Empresa */}
            <div className="flex flex-col gap-1 lg:col-span-1" ref={empresaRef}>
              <label className="text-xs font-medium text-muted-foreground">Empresa</label>
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
            <PeriodSelect
              id="sel-inicio"
              label="Período início"
              value={periodoInicio}
              onChange={setPeriodoInicio}
              competencias={competencias}
              disabled={carregandoComp}
            />

            {/* Período fim */}
            <PeriodSelect
              id="sel-fim"
              label="Período fim"
              value={periodoFim}
              onChange={setPeriodoFim}
              competencias={competencias}
              disabled={carregandoComp}
            />

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
                onPointerUp={() => { if (cnpj && periodoInicio && periodoFim) void buscarRef.current(); }}
                className="h-9 w-full accent-primary"
              />
            </div>
          </div>

          {/* Linha 2: busca inline + tipo + botão */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <MagnifyingGlassIcon size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filtrar por nome ou CNPJ…"
                value={busca}
                onChange={e => setBusca(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="flex rounded-md border border-input overflow-hidden">
              {(['CLIENTE', 'FORNECEDOR'] as TipoParticipante[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipo(t)}
                  className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                    tipo === t ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {t === 'CLIENTE' ? 'Clientes' : 'Fornecedores'}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void buscar()}
              disabled={carregandoPrincipal || !cnpj || !periodoInicio || !periodoFim}
              className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <MagnifyingGlassIcon size={14} className={carregandoPrincipal ? 'animate-spin' : ''} />
              {carregandoPrincipal ? 'Buscando…' : 'Buscar'}
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ── Resultados ── */}
      {(hasData || carregandoPrincipal) && (
        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
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
            {/* Gráfico — aparece em ambas as abas */}
            {dadosGrafico.length > 0 && !carregandoPrincipal && (
              <GraficoBarras rows={dadosGrafico} titulo={tituloGrafico} />
            )}

            {/* Tabelas */}
            {tab === 'individual' && (
              <TabelaRanking rows={rankingFiltrado} carregando={carregandoRank} />
            )}
            {tab === 'grupo' && (
              <TabelaGrupo rows={raizFiltrado} carregando={carregandoGrupo} onDrillDown={abrirDrillDown} />
            )}
          </div>
        </div>
      )}

      {/* ── Estado vazio ── */}
      {!hasData && !carregandoPrincipal && (
        <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
          <BuildingsIcon size={40} />
          <p className="text-sm">Selecione uma empresa e o período para iniciar a análise</p>
        </div>
      )}

      {/* ── Drill-down grupo econômico ── */}
      <Modal
        isOpen={drilldownAberto}
        onClose={() => setDrilldownAberto(false)}
        title={drilldownGrupo ? `Grupo: ${drilldownGrupo.razaoSocial}` : 'Grupo Econômico'}
        subtitle={drilldownGrupo ? `Raiz CNPJ: ${formatarCnpj(drilldownGrupo.cnpjRaiz)} · ${drilldownGrupo.qtdCnpjs} CNPJ(s)` : undefined}
        size="3xl"
      >
        {carregandoDrill ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (
          <TabelaDrillDown rows={drilldownRows} />
        )}
      </Modal>
    </div>
  );
}
