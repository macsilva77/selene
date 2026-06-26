'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { ScalesIcon, CalculatorIcon, SealCheckIcon, WarningIcon, ProhibitIcon } from '@phosphor-icons/react';
import {
  analiseCreditoApi,
  type SimulacaoTributaria,
  type RegimeSimulado,
  type Regime,
} from '@/lib/analise-credito-api';

/* ─── Formatação ─────────────────────────────────────────────────────────── */

function fmtBrl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtMilhoes(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `R$ ${(v / 1e9).toFixed(2)} bi`;
  if (abs >= 1e6) return `R$ ${(v / 1e6).toFixed(2)} mi`;
  if (abs >= 1e3) return `R$ ${(v / 1e3).toFixed(0)} mil`;
  return fmtBrl(v);
}
function fmtPct(frac: number | null | undefined, casas = 1): string {
  if (frac === null || frac === undefined) return '—';
  return `${(frac * 100).toFixed(casas)}%`;
}
function fmtValorMem(v: number, tipo?: string): string {
  if (tipo === 'percentual' || tipo === 'fator') return fmtPct(v, 2);
  return fmtBrl(v);
}

const ROTULO_REGIME: Record<Regime, string> = {
  simples_nacional: 'Simples Nacional',
  lucro_presumido:  'Lucro Presumido',
  lucro_real:       'Lucro Real',
};

// Cor por tributo (composição / partilha)
const COR_TRIBUTO: Record<string, string> = {
  IRPJ:   '#3B5BDB',
  CSLL:   '#1098AD',
  COFINS: '#7048E8',
  PIS:    '#9775FA',
  CPP:    '#F59F00',
  ICMS:   '#37B24D',
  ISS:    '#37B24D',
};

/* ─── Componente ─────────────────────────────────────────────────────────── */

interface Props {
  cnpj: string | null;
  exercicio: number | null;
  regimeAtualLabel: string | null;
}

export function PlanejamentoTributario({ cnpj, exercicio, regimeAtualLabel }: Readonly<Props>) {
  const [data, setData]   = useState<SimulacaoTributaria | null>(null);
  const [load, setLoad]   = useState(false);
  const [erro, setErro]   = useState(false);
  const [memoria, setMemoria] = useState(false);
  const [foco, setFoco]   = useState<Regime>('lucro_presumido');

  useEffect(() => {
    if (!cnpj || !exercicio) { setData(null); return; }
    let vivo = true;
    setLoad(true); setErro(false);
    analiseCreditoApi.simulacaoTributaria(cnpj, exercicio)
      .then(r => { if (vivo) setData(r); })
      .catch(() => { if (vivo) setErro(true); })
      .finally(() => { if (vivo) setLoad(false); });
    return () => { vivo = false; };
  }, [cnpj, exercicio]);

  const sim = data?.simulacao ?? null;

  // Regime atual e recomendado (objetos)
  const atual = useMemo(
    () => sim?.regimes.find(r => r.regime === sim.regimeAtual) ?? null,
    [sim],
  );
  const recomendado = useMemo(
    () => sim?.regimes.find(r => r.regime === sim.recomendado) ?? null,
    [sim],
  );

  // Foca no recomendado quando os dados chegam
  useEffect(() => {
    if (sim?.recomendado) setFoco(sim.recomendado);
  }, [sim?.recomendado]);

  if (load) {
    return (
      <Card><CardContent className="p-5 space-y-3">
        <Skeleton className="h-4 w-48" /><Skeleton className="h-20 w-full" />
      </CardContent></Card>
    );
  }
  if (erro || !cnpj || !exercicio) return null;
  if (data && (data.processando || !sim)) {
    return (
      <Card><CardContent className="p-5 text-sm text-muted-foreground flex items-center gap-2">
        <WarningIcon size={16} /> {data.mensagem ?? 'Sem base de receita para simular o exercício.'}
      </CardContent></Card>
    );
  }
  if (!sim || !data) return null;

  const cargaAtual = atual?.cargaEfetiva ?? null;
  const tributosAtual = atual?.totalFederal ?? null;
  const focoRegime = sim.regimes.find(r => r.regime === foco) ?? recomendado ?? sim.regimes[0];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <ScalesIcon size={15} /> Planejamento Tributário
            <span className="font-normal text-muted-foreground">· {data.exercicio}</span>
          </CardTitle>
          <div className="flex items-center gap-2">
            {sim.economiaVsAtual !== null && sim.economiaVsAtual > 0 && sim.recomendado !== sim.regimeAtual && (
              <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border border-emerald-300 text-emerald-700 bg-emerald-50">
                <SealCheckIcon size={13} weight="fill" /> Economia de {fmtMilhoes(sim.economiaVsAtual)}/ano
              </span>
            )}
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setMemoria(true)}>
              <CalculatorIcon size={14} className="mr-1" /> Memória de cálculo
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Compara a carga <strong>federal</strong> (IRPJ, CSLL, PIS, COFINS) nos três regimes a partir da receita real
          ({data.fonteReceita}). No Simples, o DAS embute ainda CPP e ICMS/ISS — detalhados na memória.
        </p>
      </CardHeader>

      <CardContent className="pt-0 space-y-5">
        {/* Linha de situação atual */}
        <div className="grid grid-cols-3 gap-4">
          <Indicador rotulo="Regime atual" valor={regimeAtualLabel ?? ROTULO_REGIME[sim.regimeAtual as Regime] ?? '—'} />
          <Indicador rotulo="Carga federal efetiva" valor={fmtPct(cargaAtual)} sub="sobre a receita" />
          <Indicador rotulo="Tributos federais/ano" valor={fmtMilhoes(tributosAtual)} sub="no regime atual" />
        </div>

        {/* Simulação por regime */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Simulação por regime</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {sim.regimes.map(r => (
              <RegimeCard
                key={r.regime}
                r={r}
                atualRegime={sim.regimeAtual}
                recomendado={sim.recomendado}
                tributosAtual={tributosAtual}
                focado={foco === r.regime}
                onClick={() => r.elegivel && setFoco(r.regime)}
              />
            ))}
          </div>
        </div>

        {/* Composição dos tributos do regime focado */}
        {focoRegime?.elegivel && focoRegime.tributos.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Composição — {ROTULO_REGIME[focoRegime.regime]}
              {focoRegime.regime === 'simples_nacional' && focoRegime.totalUnificado
                ? ` · DAS ${fmtMilhoes(focoRegime.totalUnificado)}`
                : ''}
            </p>
            <Composicao r={focoRegime} />
          </div>
        )}
      </CardContent>

      {/* Modal — Memória de cálculo */}
      <Modal isOpen={memoria} onClose={() => setMemoria(false)} size="3xl"
        title="Memória de cálculo" subtitle={`${data.razaoSocial} · exercício ${data.exercicio}`}>
        <MemoriaConteudo sim={sim} focoInicial={foco} />
      </Modal>
    </Card>
  );
}

/* ─── Subcomponentes ─────────────────────────────────────────────────────── */

function Indicador({ rotulo, valor, sub }: Readonly<{ rotulo: string; valor: string; sub?: string }>) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-base font-bold leading-tight">{valor}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function RegimeCard({ r, atualRegime, recomendado, tributosAtual, focado, onClick }: Readonly<{
  r: RegimeSimulado; atualRegime: Regime | null; recomendado: Regime | null;
  tributosAtual: number | null; focado: boolean; onClick: () => void;
}>) {
  const isRecom = r.regime === recomendado;
  const isAtual = r.regime === atualRegime;
  const delta = r.totalFederal !== null && tributosAtual !== null ? r.totalFederal - tributosAtual : null;

  const borda = !r.elegivel
    ? 'border-border opacity-70'
    : focado
      ? 'border-primary ring-1 ring-primary/30'
      : 'border-border hover:border-primary/40';

  return (
    <button type="button" onClick={onClick} disabled={!r.elegivel}
      className={`text-left rounded-lg border ${borda} bg-card p-3 transition-colors ${r.elegivel ? 'cursor-pointer' : 'cursor-default'}`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-semibold text-foreground">{r.rotulo}</span>
        {isRecom && r.elegivel && (
          <span className="text-[10px] font-bold uppercase tracking-wide text-primary">Recomendado</span>
        )}
      </div>

      {!r.elegivel ? (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground py-1.5">
          <ProhibitIcon size={15} /> Não elegível
        </div>
      ) : (
        <>
          <p className="text-xl font-bold tabular-nums leading-tight">{fmtMilhoes(r.totalFederal)}</p>
          <p className="text-[11px] mt-0.5">
            {isAtual ? (
              <span className="text-muted-foreground">atual{r.estimado ? ' · estimado' : ''}</span>
            ) : delta === null ? (
              <span className="text-muted-foreground">{r.estimado ? 'estimado' : ''}</span>
            ) : delta < 0 ? (
              <span className="font-semibold text-emerald-600">economiza {fmtMilhoes(-delta)}</span>
            ) : delta > 0 ? (
              <span className="font-semibold text-amber-600">+ {fmtMilhoes(delta)}</span>
            ) : (
              <span className="text-muted-foreground">igual ao atual</span>
            )}
          </p>
          {r.regime === 'simples_nacional' && r.totalUnificado != null && (
            <p className="text-[10px] text-muted-foreground mt-0.5">DAS {fmtMilhoes(r.totalUnificado)} (c/ CPP+ICMS/ISS)</p>
          )}
        </>
      )}
    </button>
  );
}

function Composicao({ r }: Readonly<{ r: RegimeSimulado }>) {
  const total = r.tributos.reduce((s, t) => s + t.valor, 0) || 1;
  const max = Math.max(...r.tributos.map(t => t.valor), 1);
  return (
    <div className="space-y-1.5">
      {r.tributos.map(t => {
        const pct = (t.valor / max) * 100;
        const share = t.valor / total;
        return (
          <div key={t.sigla} className="flex items-center gap-3 text-xs">
            <span className="w-16 shrink-0 text-muted-foreground">{t.sigla}</span>
            <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: COR_TRIBUTO[t.sigla] ?? '#868E96' }} />
            </div>
            <span className="w-24 shrink-0 text-right tabular-nums">{fmtMilhoes(t.valor)}</span>
            {t.partilha != null && <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">{fmtPct(share)}</span>}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Memória de cálculo (modal) ─────────────────────────────────────────── */

function MemoriaConteudo({ sim, focoInicial }: Readonly<{ sim: NonNullable<SimulacaoTributaria['simulacao']>; focoInicial: Regime }>) {
  const [aba, setAba] = useState<Regime>(focoInicial);
  const r = sim.regimes.find(x => x.regime === aba) ?? sim.regimes[0];

  return (
    <div className="space-y-4">
      {/* Abas por regime */}
      <div className="flex gap-1 border-b border-border">
        {sim.regimes.map(rg => (
          <button key={rg.regime} type="button" onClick={() => setAba(rg.regime)}
            className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
              aba === rg.regime ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}>
            {rg.rotulo}
          </button>
        ))}
      </div>

      {!r.elegivel ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2 py-4">
          <ProhibitIcon size={16} /> {r.observacoes[0] ?? 'Regime não elegível para esta empresa.'}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Total + carga */}
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div>
              <span className="text-xs text-muted-foreground">Total federal</span>
              <p className="text-lg font-bold tabular-nums">{fmtBrl(r.totalFederal ?? 0)}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Carga efetiva</span>
              <p className="text-lg font-bold tabular-nums">{fmtPct(r.cargaEfetiva, 2)}</p>
            </div>
            {r.regime === 'simples_nacional' && r.totalUnificado != null && (
              <div>
                <span className="text-xs text-muted-foreground">DAS total (unificado)</span>
                <p className="text-lg font-bold tabular-nums">{fmtBrl(r.totalUnificado)}</p>
              </div>
            )}
            {r.estimado && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium">
                <WarningIcon size={13} /> valor estimado
              </span>
            )}
          </div>

          {/* Tributo a tributo */}
          <div className="space-y-3">
            {r.tributos.map(t => (
              <div key={t.sigla} className="rounded-lg border border-border overflow-hidden">
                <div className="flex items-center justify-between bg-muted/40 px-3 py-1.5">
                  <span className="text-xs font-semibold">
                    {t.sigla} <span className="font-normal text-muted-foreground">· {t.nome}</span>
                    {t.partilha != null && <span className="ml-1 text-muted-foreground">({fmtPct(t.partilha, 2)} do DAS)</span>}
                  </span>
                  <span className="text-xs font-bold tabular-nums">{fmtBrl(t.valor)}</span>
                </div>
                <table className="w-full text-xs">
                  <tbody>
                    {t.memoria.map((p, i) => (
                      <tr key={i} className="border-t border-border/50">
                        <td className="px-3 py-1.5 text-muted-foreground">{p.rotulo}</td>
                        <td className="px-3 py-1.5 text-muted-foreground font-mono text-[11px]">{p.formula ?? ''}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{fmtValorMem(p.valor, p.tipo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          {/* Observações do regime */}
          {r.observacoes.length > 0 && (
            <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
              {r.observacoes.map((o, i) => <li key={i}>{o}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Premissas gerais */}
      <div className="rounded-lg bg-muted/40 border border-border p-3">
        <p className="text-xs font-semibold mb-1">Premissas da simulação</p>
        <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
          {sim.premissas.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      </div>
    </div>
  );
}
