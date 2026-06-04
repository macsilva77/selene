'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  PlayIcon,
  ArrowClockwiseIcon,
  CheckCircleIcon,
  WarningIcon,
  XCircleIcon,
  BuildingsIcon,
  BugIcon,
  GearIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast, ToastContainer } from '@/components/ui/toast';
import {
  analiseCreditoApi,
  type EmpresaResumo,
  type StatusPipeline,
  type Indicador,
  type Alerta,
  type ClassificacaoRisco,
  type Classificacao,
  type Inconsistencia,
  type ResumoFinanceiro,
} from '@/lib/analise-credito-api';
import { VisaoGeral } from './visao-geral';

/* ─── Helpers visuais ────────────────────────────────────────────────────── */

const CLS_COLOR: Record<Classificacao, string> = {
  A: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  B: 'bg-green-100   text-green-800   border-green-300',
  C: 'bg-yellow-100  text-yellow-800  border-yellow-300',
  D: 'bg-orange-100  text-orange-800  border-orange-300',
  E: 'bg-red-100     text-red-800     border-red-300',
};

const SEV_COLOR: Record<string, string> = {
  critico:  'bg-red-100     text-red-700     border-red-300',
  atencao:  'bg-amber-100   text-amber-700   border-amber-300',
  positivo: 'bg-emerald-100 text-emerald-700 border-emerald-300',
};

const INC_SEV_COLOR: Record<string, string> = {
  bloqueio: 'bg-red-100   text-red-700   border-red-300',
  alerta:   'bg-amber-100 text-amber-700 border-amber-300',
  info:     'bg-blue-100  text-blue-700  border-blue-300',
};

function formatarCnpj(cnpj: string) {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function formatarValor(valor: string | null, unidade: string): string {
  if (valor === null) return '—';
  const n = parseFloat(valor);
  if (Number.isNaN(n)) return valor;
  if (unidade === 'percentual') return `${(n * 100).toFixed(1)}%`;
  if (unidade === 'ratio')      return n.toFixed(2);
  if (unidade === 'dias')       return `${n.toFixed(0)} dias`;
  if (unidade === 'reais')      return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return n.toFixed(2);
}

type Tab = 'visao' | 'estrutura' | 'evolucao' | 'alertas' | 'parecer' | 'pipeline' | 'inconsistencias';

/* ─── Componente principal ───────────────────────────────────────────────── */

export function AnaliseCreditoDashboard() {
  const { toasts, success, error: toastError, dismiss } = useToast();

  const [empresas, setEmpresas]               = useState<EmpresaResumo[]>([]);
  const [cnpjSelecionado, setCnpjSelecionado] = useState<string>('');
  const [tab, setTab]                         = useState<Tab>('visao');
  const [carregando, setCarregando]           = useState(false);
  const [disparando, setDisparando]           = useState(false);
  const [resetando, setResetando]             = useState(false);

  const [statusData, setStatusData]           = useState<StatusPipeline[]>([]);
  const [indicadores, setIndicadores]         = useState<Indicador[]>([]);
  const [alertas, setAlertas]                 = useState<Alerta[]>([]);
  const [classificacao, setClassificacao]     = useState<ClassificacaoRisco[]>([]);
  const [inconsistencias, setInconsistencias] = useState<Inconsistencia[]>([]);
  const [financeiro, setFinanceiro]           = useState<ResumoFinanceiro | null>(null);
  const [financeiroPrevio, setFinanceiroPrevio] = useState<ResumoFinanceiro | null>(null);
  const [exercicioFiltro, setExercicioFiltro] = useState<number | undefined>();

  useEffect(() => {
    analiseCreditoApi.listarEmpresas()
      .then(setEmpresas)
      .catch(() => toastError('Erro ao carregar empresas'));
  }, [toastError]);

  const carregarFinanceiro = useCallback(async (cnpj: string, exercicioAlvo: number) => {
    try {
      const f = await analiseCreditoApi.financeiro(cnpj, exercicioAlvo);
      setFinanceiro(f);
      try {
        setFinanceiroPrevio(await analiseCreditoApi.financeiro(cnpj, exercicioAlvo - 1));
      } catch {
        setFinanceiroPrevio(null);
      }
    } catch {
      setFinanceiro(null);
      setFinanceiroPrevio(null);
    }
  }, []);

  const carregarDados = useCallback(async (cnpj: string, exercicio?: number) => {
    if (!cnpj) return;
    setCarregando(true);
    try {
      const [status, inds, als, cls, incs] = await Promise.all([
        analiseCreditoApi.statusPipeline(cnpj),
        analiseCreditoApi.indicadores(cnpj),
        analiseCreditoApi.alertas(cnpj),
        analiseCreditoApi.classificacao(cnpj),
        analiseCreditoApi.inconsistencias(cnpj),
      ]);
      setStatusData(status ?? []);
      setIndicadores(inds);
      setAlertas(als);
      setClassificacao(cls);
      setInconsistencias(incs);
      const exercicioAlvo = exercicio ?? status?.[0]?.exercicio;
      if (exercicioAlvo) void carregarFinanceiro(cnpj, exercicioAlvo);
    } catch {
      toastError('Erro ao carregar dados da empresa');
    } finally {
      setCarregando(false);
    }
  }, [toastError, carregarFinanceiro]);

  useEffect(() => {
    if (cnpjSelecionado) carregarDados(cnpjSelecionado, exercicioFiltro);
  }, [cnpjSelecionado, exercicioFiltro, carregarDados]);

  async function resetarDados() {
    if (!window.confirm('Apagar todos os dados calculados (balanço, DRE, indicadores, alertas e classificações)?\n\nOs arquivos ECF/ECD originais serão preservados.')) return;
    setResetando(true);
    try {
      const res = await analiseCreditoApi.resetarDados();
      success(`Dados limpos: ${res.totais.balanco ?? 0} balanços · ${res.totais.indicadores ?? 0} indicadores · ${res.totais.classificacoes ?? 0} classificações`);
      setCnpjSelecionado('');
    } catch {
      toastError('Erro ao resetar dados');
    } finally {
      setResetando(false);
    }
  }

  async function dispararPipeline() {
    setDisparando(true);
    try {
      await analiseCreditoApi.dispararPipeline();
      success('Pipeline P01→P04 iniciado em background');
    } catch {
      toastError('Erro ao disparar pipeline');
    } finally {
      setDisparando(false);
    }
  }

  const empresaSelecionada = useMemo(
    () => empresas.find(e => e.cnpj === cnpjSelecionado),
    [empresas, cnpjSelecionado],
  );

  const exerciciosDisponiveis = useMemo(() => (
    [...new Set([
      ...statusData.map(s => s.exercicio),
      ...indicadores.map(i => i.exercicio),
      ...alertas.map(a => a.exercicio),
      ...classificacao.map(c => c.exercicio),
    ])].sort((a, b) => b - a)
  ), [statusData, indicadores, alertas, classificacao]);

  const indPorCategoria = useMemo(() => (
    indicadores
      .filter(i => exercicioFiltro === undefined || i.exercicio === exercicioFiltro)
      .reduce<Record<string, Indicador[]>>((acc, i) => {
        const cat = i.indicador.split('_')[0] ?? 'Outros';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(i);
        return acc;
      }, {})
  ), [indicadores, exercicioFiltro]);

  const alertasFiltrados = useMemo(
    () => alertas.filter(a => exercicioFiltro === undefined || a.exercicio === exercicioFiltro),
    [alertas, exercicioFiltro],
  );

  const incsFiltradas = useMemo(
    () => inconsistencias.filter(i => exercicioFiltro === undefined || i.exercicio === exercicioFiltro),
    [inconsistencias, exercicioFiltro],
  );

  const totalBloqueios = useMemo(
    () => statusData.reduce((s, r) => s + r.totalBloqueios, 0),
    [statusData],
  );

  const exercicioAtivo = exercicioFiltro ?? exerciciosDisponiveis[0];

  /* ── Tabs principais (visíveis no sub-header) ─────────────────────────── */
  const TAB_ITEMS: { id: Tab; label: string }[] = [
    { id: 'visao',     label: 'Visão geral'         },
    { id: 'estrutura', label: 'Estrutura de capital' },
    { id: 'evolucao',  label: 'Evolução'             },
    { id: 'alertas',   label: `Alertas${alertasFiltrados.length ? ` (${alertasFiltrados.length})` : ''}` },
    { id: 'parecer',   label: 'Parecer'              },
  ];

  return (
    <div className="flex flex-col gap-4 p-6">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      {/* ── Cabeçalho da página ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Análise de Crédito</h1>
          <p className="text-sm text-muted-foreground">Pipeline P01→P04 · ECD/ECF → Balanço → Indicadores → Classificação</p>
        </div>
        <button
          onClick={dispararPipeline}
          type="button"
          disabled={disparando}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {disparando
            ? <ArrowClockwiseIcon size={16} className="animate-spin" />
            : <PlayIcon size={16} weight="fill" />}
          Disparar Pipeline
        </button>
        <button
          onClick={resetarDados}
          type="button"
          disabled={resetando}
          title="Apaga balanço, DRE, indicadores, alertas e classificações. Preserva ECF/ECD."
          className="flex items-center gap-2 rounded-md border border-destructive px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
        >
          {resetando
            ? <ArrowClockwiseIcon size={16} className="animate-spin" />
            : <TrashIcon size={16} weight="bold" />}
          Limpar dados
        </button>
      </div>

      {/* ── Seletor de empresa ── */}
      <Card className="w-full border">
        <CardContent className="flex flex-wrap items-center gap-4 p-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="sel-empresa" className="text-xs font-medium text-muted-foreground">Empresa</label>
            <select
              id="sel-empresa"
              className="h-9 min-w-[320px] rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              value={cnpjSelecionado}
              onChange={e => { setCnpjSelecionado(e.target.value); setExercicioFiltro(undefined); }}
            >
              <option value="">Selecione uma empresa…</option>
              {empresas.map(e => (
                <option key={e.cnpj} value={e.cnpj}>
                  {formatarCnpj(e.cnpj)} — {e.razaoSocial}
                </option>
              ))}
            </select>
          </div>

          {exerciciosDisponiveis.length > 0 && (
            <div className="flex flex-col gap-1">
              <label htmlFor="sel-exercicio" className="text-xs font-medium text-muted-foreground">Exercício</label>
              <select
                id="sel-exercicio"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={exercicioFiltro ?? ''}
                onChange={e => setExercicioFiltro(e.target.value ? Number(e.target.value) : undefined)}
              >
                <option value="">Todos</option>
                {exerciciosDisponiveis.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Container principal: sub-header + conteúdo ── */}
      {cnpjSelecionado && (
        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">

          {/* Sub-header: empresa + exercício (esq) · tabs (dir) */}
          <div className="flex items-center justify-between gap-4 border-b border-border bg-muted/40 px-6 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate font-semibold text-foreground">
                  {empresaSelecionada?.razaoSocial ?? '—'}
                </p>
                {empresaSelecionada?.ultimaClassificacao && (
                  <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${CLS_COLOR[empresaSelecionada.ultimaClassificacao.classificacao]}`}>
                    {empresaSelecionada.ultimaClassificacao.classificacao}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {formatarCnpj(cnpjSelecionado)}
                {exercicioAtivo ? ` · Exercício ${exercicioAtivo}` : ''}
                {empresaSelecionada?.regimeTributario ? ` · ${empresaSelecionada.regimeTributario.replace('_', ' ')}` : ''}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {TAB_ITEMS.map(t => (
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
              {/* Diagnósticos (pipeline + inconsistências) como ação secundária */}
              <button
                type="button"
                onClick={() => setTab(tab === 'pipeline' ? 'visao' : 'pipeline')}
                title="Diagnósticos do pipeline"
                className={`ml-1 flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition-colors ${
                  tab === 'pipeline' || tab === 'inconsistencias'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                <GearIcon size={14} />
                {totalBloqueios > 0 && (
                  <span className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                    {totalBloqueios}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Conteúdo das tabs */}
          <div className="p-6">
            {carregando ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                <ArrowClockwiseIcon size={18} className="mr-2 animate-spin" /> Carregando…
              </div>
            ) : (
              <>
                {/* ── Visão geral ── */}
                {tab === 'visao' && (
                  <VisaoGeral
                    exercicio={exercicioAtivo ?? 0}
                    indicadores={indicadores}
                    alertas={alertas}
                    financeiro={financeiro}
                    financeiroPrevio={financeiroPrevio}
                  />
                )}

                {/* ── Estrutura de capital ── */}
                {tab === 'estrutura' && (
                  <div className="flex flex-col gap-4">
                    {financeiro?.estrutura ? (
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                        {[
                          { label: 'Ativo total',       v: financeiro.estrutura.ativoTotal },
                          { label: 'Passivo total',      v: financeiro.estrutura.passivoTotal },
                          { label: 'Patrimônio líquido', v: financeiro.estrutura.pl },
                          { label: 'Dívida líquida',     v: financeiro.estrutura.dividaLiquida },
                        ].map(({ label, v }) => (
                          <div key={label} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                            <p className="text-xs text-muted-foreground">{label}</p>
                            <p className="mt-1 text-lg font-bold text-foreground tabular-nums">
                              {v ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Dados de estrutura não disponíveis para este exercício.</p>
                    )}
                  </div>
                )}

                {/* ── Evolução (indicadores por categoria) ── */}
                {tab === 'evolucao' && (
                  <div className="flex flex-col gap-4">
                    {Object.keys(indPorCategoria).length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhum indicador disponível.</p>
                    ) : (
                      Object.entries(indPorCategoria).map(([cat, inds]) => (
                        <div key={cat} className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
                          <p className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Grupo {cat}
                          </p>
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-border bg-muted/40">
                                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Indicador</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Exercício</th>
                                <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Valor</th>
                                <th className="px-4 py-2 text-center text-xs font-medium text-muted-foreground">Fonte</th>
                              </tr>
                            </thead>
                            <tbody>
                              {inds.map(i => (
                                <tr key={`${i.exercicio}-${i.indicador}`} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                                  <td className="px-4 py-2 font-mono text-xs text-foreground">{i.indicador}</td>
                                  <td className="px-4 py-2 text-muted-foreground">{i.exercicio}</td>
                                  <td className="px-4 py-2 text-right font-medium text-foreground">
                                    {i.valor === null
                                      ? <span className="italic text-muted-foreground">NULL</span>
                                      : formatarValor(i.valor, i.unidade)}
                                  </td>
                                  <td className="px-4 py-2 text-center">
                                    {i.fonteOk === 1
                                      ? <span className="text-xs text-emerald-600">direta</span>
                                      : <span className="text-xs text-amber-600">inferida</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* ── Alertas ── */}
                {tab === 'alertas' && (
                  <div className="flex flex-col gap-3">
                    {alertasFiltrados.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhum alerta para o filtro selecionado.</p>
                    ) : (
                      (['critico', 'atencao', 'positivo'] as const).map(sev => {
                        const grupo = alertasFiltrados.filter(a => a.severidade === sev);
                        if (grupo.length === 0) return null;
                        const sevIcon = {
                          critico:  <XCircleIcon weight="fill" className="text-red-500" size={14} />,
                          atencao:  <WarningIcon weight="fill" className="text-amber-500" size={14} />,
                          positivo: <CheckCircleIcon weight="fill" className="text-emerald-500" size={14} />,
                        }[sev];
                        return (
                          <div key={sev} className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
                            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                              {sevIcon}
                              <span className="text-sm font-medium capitalize text-foreground">{sev}</span>
                              <Badge className={`ml-1 ${SEV_COLOR[sev]}`}>{grupo.length}</Badge>
                            </div>
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-border bg-muted/40">
                                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Código</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Exercício</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Categoria</th>
                                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Mensagem</th>
                                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Valor</th>
                                </tr>
                              </thead>
                              <tbody>
                                {grupo.map(a => (
                                  <tr key={`${a.exercicio}-${a.codigoRegra}`} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                                    <td className="px-4 py-2 font-mono text-xs text-foreground">{a.codigoRegra}</td>
                                    <td className="px-4 py-2 text-muted-foreground">{a.exercicio}</td>
                                    <td className="px-4 py-2 text-xs text-muted-foreground">{a.categoria}</td>
                                    <td className="px-4 py-2 text-foreground">{a.mensagem}</td>
                                    <td className="px-4 py-2 text-right font-mono text-xs text-foreground">
                                      {a.valorAtual != null ? parseFloat(a.valorAtual).toFixed(3) : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {/* ── Parecer (classificação de risco) ── */}
                {tab === 'parecer' && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {classificacao.length === 0 ? (
                      <p className="col-span-3 text-sm text-muted-foreground">Nenhuma classificação gerada ainda.</p>
                    ) : (
                      classificacao.map(c => (
                        <div key={c.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="text-sm font-medium text-muted-foreground">Exercício {c.exercicio}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Confiabilidade: <span className="font-medium text-foreground">{c.confiabilidade}</span>
                              </p>
                            </div>
                            <span className={`inline-flex h-12 w-12 items-center justify-center rounded-full border-2 text-2xl font-bold ${CLS_COLOR[c.classificacao]}`}>
                              {c.classificacao}
                            </span>
                          </div>
                          <div className="mt-3 flex gap-3 text-xs">
                            <span className="flex items-center gap-1 text-red-600"><XCircleIcon weight="fill" size={13} /> {c.qtdCriticos} críticos</span>
                            <span className="flex items-center gap-1 text-amber-600"><WarningIcon weight="fill" size={13} /> {c.qtdAtencao} atenção</span>
                            <span className="flex items-center gap-1 text-emerald-600"><CheckCircleIcon weight="fill" size={13} /> {c.qtdPositivos} positivos</span>
                          </div>
                          {c.overrideAplicado && c.motivoOverride && (
                            <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                              Override: {c.motivoOverride}
                            </p>
                          )}
                          <p className="mt-2 text-xs text-muted-foreground">
                            Gerado em {new Date(c.dataGeracao).toLocaleDateString('pt-BR')}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* ── Pipeline (diagnóstico) ── */}
                {tab === 'pipeline' && (
                  <div className="flex flex-col gap-4">
                    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
                      <p className="border-b border-border px-4 py-3 text-sm font-medium text-foreground">
                        Status do Pipeline por Exercício
                      </p>
                      {statusData.length === 0 ? (
                        <p className="p-6 text-sm text-muted-foreground">Nenhum processamento encontrado para esta empresa.</p>
                      ) : (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border bg-muted/40">
                              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Exercício</th>
                              <th className="px-4 py-2 text-center text-xs font-medium text-muted-foreground">P01</th>
                              <th className="px-4 py-2 text-center text-xs font-medium text-muted-foreground">P02</th>
                              <th className="px-4 py-2 text-center text-xs font-medium text-muted-foreground">P03</th>
                              <th className="px-4 py-2 text-center text-xs font-medium text-muted-foreground">P04</th>
                              <th className="px-4 py-2 text-center text-xs font-medium text-muted-foreground">Bloqueios</th>
                            </tr>
                          </thead>
                          <tbody>
                            {statusData.map(s => (
                              <tr key={s.exercicio} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                                <td className="px-4 py-2 font-medium text-foreground">{s.exercicio}</td>
                                {(['p01', 'p02', 'p03', 'p04'] as const).map(p => (
                                  <td key={p} className="px-4 py-2 text-center">
                                    {s[p]
                                      ? <span className="flex items-center justify-center gap-1 text-emerald-600"><CheckCircleIcon weight="fill" size={14} />{s[p]}</span>
                                      : <span className="text-muted-foreground">—</span>}
                                  </td>
                                ))}
                                <td className="px-4 py-2 text-center">
                                  {s.totalBloqueios > 0 ? (
                                    <button type="button" onClick={() => setTab('inconsistencias')} title="Ver inconsistências">
                                      <Badge className={SEV_COLOR.critico}>
                                        {s.totalBloqueios}
                                      </Badge>
                                    </button>
                                  ) : (
                                    <span className="text-muted-foreground">0</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Inconsistências (diagnóstico) ── */}
                {tab === 'inconsistencias' && (
                  <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
                    <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                      <BugIcon size={16} className="text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">Inconsistências do Pipeline</span>
                      {incsFiltradas.filter(i => i.severidade === 'bloqueio').length > 0 && (
                        <Badge className={SEV_COLOR.critico}>
                          {incsFiltradas.filter(i => i.severidade === 'bloqueio').length} bloqueios
                        </Badge>
                      )}
                    </div>
                    {incsFiltradas.length === 0 ? (
                      <p className="p-6 text-sm text-muted-foreground">Nenhuma inconsistência registrada.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border bg-muted/40">
                            <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Severidade</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Exercício</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Tipo</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Descrição</th>
                            <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Data</th>
                          </tr>
                        </thead>
                        <tbody>
                          {incsFiltradas.map(i => (
                            <tr key={i.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                              <td className="px-4 py-2">
                                <Badge className={INC_SEV_COLOR[i.severidade] ?? 'bg-muted text-muted-foreground'}>
                                  {i.severidade}
                                </Badge>
                              </td>
                              <td className="px-4 py-2 text-muted-foreground">{i.exercicio}</td>
                              <td className="px-4 py-2 font-mono text-xs text-foreground">{i.tipoErro}</td>
                              <td className="px-4 py-2 text-sm text-foreground">{i.descricao}</td>
                              <td className="px-4 py-2 whitespace-nowrap text-xs text-muted-foreground">
                                {new Date(i.criadoEm).toLocaleString('pt-BR')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {!cnpjSelecionado && empresas.length > 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
          <BuildingsIcon size={40} />
          <p className="text-sm">Selecione uma empresa para ver a análise de crédito</p>
        </div>
      )}

      {empresas.length === 0 && !carregando && (
        <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
          <PlayIcon size={40} />
          <p className="text-sm">Nenhuma empresa processada ainda. Dispare o Pipeline para começar.</p>
        </div>
      )}
    </div>
  );
}
