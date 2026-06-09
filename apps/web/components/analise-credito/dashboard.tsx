'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowClockwiseIcon,
  BuildingsIcon,
  WarningIcon,
  GearIcon,
  ArrowsClockwiseIcon,
} from '@phosphor-icons/react';
import { Card, CardContent } from '@/components/ui/card';
import { useToast, ToastContainer } from '@/components/ui/toast';
import {
  analiseCreditoApi,
  type EmpresaResumo,
  type Indicador,
  type Alerta,
  type ResumoFinanceiro,
  type KpiAnual,
} from '@/lib/analise-credito-api';
import { VisaoGeral }       from './visao-geral';
import { KpisAnuais }       from './kpis-anuais';
import { EstruturaCapital } from './estrutura-capital';
import { Alertas }          from './alertas';

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function formatarCnpj(cnpj: string) {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

type Tab = 'visao' | 'estrutura' | 'evolucao' | 'alertas';

/* ─── Componente principal ───────────────────────────────────────────────── */

export function AnaliseCreditoDashboard() {
  const { toasts, error: toastError, dismiss } = useToast();

  const [empresas, setEmpresas]               = useState<EmpresaResumo[]>([]);
  const [cnpjSelecionado, setCnpjSelecionado] = useState<string>('');
  const [tab, setTab]                         = useState<Tab>('visao');
  const [carregando, setCarregando]           = useState(false);
  const [calculando, setCalculando]           = useState(false);
  const [reprocessando, setReprocessando]     = useState(false);

  const [indicadores, setIndicadores]         = useState<Indicador[]>([]);
  const [alertas, setAlertas]                 = useState<Alerta[]>([]);
  const [financeiro, setFinanceiro]           = useState<ResumoFinanceiro | null>(null);
  const [financeiroPrevio, setFinanceiroPrevio] = useState<ResumoFinanceiro | null>(null);
  const [kpisAnuais, setKpisAnuais]           = useState<KpiAnual[]>([]);
  const [exercicios, setExercicios]           = useState<number[]>([]);
  const [exercicioFiltro, setExercicioFiltro] = useState<number | undefined>();
  const [erros, setErros]                     = useState<string[]>([]);

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
    setErros([]);
    const novosErros: string[] = [];

    try {
      const [exs, inds, als, kpis] = await Promise.all([
        analiseCreditoApi.exercicios(cnpj).catch(() => { novosErros.push('Exercícios não disponíveis'); return [] as number[]; }),
        analiseCreditoApi.indicadores(cnpj).catch(() => { novosErros.push('Indicadores não calculados'); return [] as Indicador[]; }),
        analiseCreditoApi.alertas(cnpj).catch(() => [] as Alerta[]),
        analiseCreditoApi.kpisAnuais(cnpj).catch(() => [] as KpiAnual[]),
      ]);

      setExercicios(exs);
      setIndicadores(inds);
      setAlertas(als);
      setKpisAnuais(kpis);
      setErros(novosErros);

      const exercicioAlvo = exercicio ?? exs[0];
      if (exercicioAlvo) void carregarFinanceiro(cnpj, exercicioAlvo);
    } catch {
      toastError('Erro ao carregar dados da empresa');
    } finally {
      setCarregando(false);
    }
  }, [toastError, carregarFinanceiro]);

  const processarEmpresa = useCallback(async (cnpj: string) => {
    if (!cnpj || calculando) return;
    setCalculando(true);
    try {
      await analiseCreditoApi.calcular(cnpj);
      await carregarDados(cnpj, exercicioFiltro);
    } catch {
      toastError('Erro ao processar empresa');
    } finally {
      setCalculando(false);
    }
  }, [calculando, carregarDados, exercicioFiltro, toastError]);

  const reprocessarTodos = useCallback(async () => {
    if (reprocessando) return;
    setReprocessando(true);
    try {
      const res = await analiseCreditoApi.reprocessarEcf();
      if (cnpjSelecionado) setTimeout(() => carregarDados(cnpjSelecionado, exercicioFiltro), 5000);
      analiseCreditoApi.listarEmpresas().then(setEmpresas).catch(() => {});
      toastError(`${res.mensagem} — aguarde o processamento em background`);
    } catch {
      toastError('Erro ao iniciar reprocessamento');
    } finally {
      setReprocessando(false);
    }
  }, [reprocessando, cnpjSelecionado, carregarDados, exercicioFiltro, toastError]);

  useEffect(() => {
    if (cnpjSelecionado) carregarDados(cnpjSelecionado, exercicioFiltro);
  }, [cnpjSelecionado, exercicioFiltro, carregarDados]);

  const empresaSelecionada = empresas.find(e => e.cnpj === cnpjSelecionado);
  const exercicioAtivo = exercicioFiltro ?? exercicios[0];

  const qtdAlertas = alertas.filter(
    a => exercicioAtivo ? a.exercicio === exercicioAtivo : true,
  ).length;

  const TAB_ITEMS: { id: Tab; label: string; badge?: number }[] = [
    { id: 'visao',     label: 'Visão geral'          },
    { id: 'estrutura', label: 'Estrutura de capital' },
    { id: 'evolucao',  label: 'Evolução'             },
    { id: 'alertas',   label: 'Alertas', badge: qtdAlertas > 0 ? qtdAlertas : undefined },
  ];

  return (
    <div className="flex flex-col gap-4 p-6">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      {/* ── Cabeçalho ── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Análise de Crédito</h1>
          <p className="text-sm text-muted-foreground">Dados extraídos do ECF · clique em Processar para calcular indicadores</p>
        </div>
        <button
          type="button"
          onClick={reprocessarTodos}
          disabled={reprocessando}
          title="Força P01 + calcular para todas as empresas com ECF importado"
          className="flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
        >
          <ArrowsClockwiseIcon size={13} className={reprocessando ? 'animate-spin' : ''} />
          {reprocessando ? 'Reprocessando…' : 'Reprocessar ECF'}
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

          {exercicios.length > 0 && (
            <div className="flex flex-col gap-1">
              <label htmlFor="sel-exercicio" className="text-xs font-medium text-muted-foreground">Exercício</label>
              <select
                id="sel-exercicio"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={exercicioFiltro ?? ''}
                onChange={e => setExercicioFiltro(e.target.value ? Number(e.target.value) : undefined)}
              >
                <option value="">Todos</option>
                {exercicios.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          )}

          {/* Ações */}
          {cnpjSelecionado && (
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => carregarDados(cnpjSelecionado, exercicioFiltro)}
                disabled={carregando || calculando}
                className="flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                <ArrowClockwiseIcon size={13} className={carregando ? 'animate-spin' : ''} />
                Recarregar
              </button>
              <button
                type="button"
                onClick={() => processarEmpresa(cnpjSelecionado)}
                disabled={carregando || calculando}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <GearIcon size={13} className={calculando ? 'animate-spin' : ''} />
                {calculando ? 'Processando…' : 'Processar'}
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Container principal ── */}
      {cnpjSelecionado && (
        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">

          {/* Sub-header */}
          <div className="flex items-center justify-between gap-4 border-b border-border bg-muted/40 px-6 py-4">
            <div className="min-w-0">
              <p className="truncate font-semibold text-foreground">
                {empresaSelecionada?.razaoSocial ?? '—'}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatarCnpj(cnpjSelecionado)}
                {exercicioAtivo ? ` · Exercício ${exercicioAtivo}` : ''}
                {empresaSelecionada?.regimeTributario ? ` · ${empresaSelecionada.regimeTributario.replace('_', ' ')}` : ''}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {TAB_ITEMS.map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    tab === t.id
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  }`}
                >
                  {t.label}
                  {t.badge !== undefined && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                      tab === t.id ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
                    }`}>
                      {t.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Conteúdo */}
          <div className="p-6">

            {/* Erros de carregamento */}
            {erros.length > 0 && (
              <div className="mb-4 flex flex-col gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                {erros.map(e => (
                  <div key={e} className="flex items-center gap-2 text-sm text-amber-700">
                    <WarningIcon size={14} weight="fill" className="shrink-0" />
                    {e}
                  </div>
                ))}
              </div>
            )}

            {carregando ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                <ArrowClockwiseIcon size={18} className="mr-2 animate-spin" /> Carregando…
              </div>
            ) : (
              <>
                {tab === 'visao' && (
                  <VisaoGeral
                    exercicio={exercicioAtivo ?? 0}
                    indicadores={indicadores}
                    alertas={alertas}
                    financeiro={financeiro}
                    financeiroPrevio={financeiroPrevio}
                  />
                )}

                {tab === 'estrutura' && (
                  <EstruturaCapital
                    exercicio={exercicioAtivo ?? 0}
                    financeiro={financeiro}
                    indicadores={indicadores}
                    kpisAnuais={kpisAnuais}
                  />
                )}

                {tab === 'evolucao' && (
                  <div className="flex flex-col gap-4">
                    {kpisAnuais.length > 0
                      ? <KpisAnuais kpis={kpisAnuais} />
                      : <p className="text-sm text-muted-foreground">Nenhum dado disponível.</p>
                    }
                  </div>
                )}

                {tab === 'alertas' && (
                  <Alertas
                    alertas={alertas}
                    exercicio={exercicioAtivo ?? 0}
                  />
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
    </div>
  );
}
