'use client';

import React from 'react';
import {
  WarningCircleIcon,
  WarningIcon,
  CheckCircleIcon,
  BellIcon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { Alerta, Severidade } from '@/lib/analise-credito-api';

/* ─── Mapa de rótulos para indicadores ──────────────────────────────────── */

const INDICADOR_LABEL: Record<string, string> = {
  pl:                       'patrimônio líquido',
  independencia_financeira: 'independência financeira',
  lucro_liquido:            'lucro líquido',
  liquidez_corrente:        'liquidez corrente',
  liquidez_seca:            'liquidez seca',
  liquidez_imediata:        'liquidez imediata',
  liquidez_geral:           'liquidez geral',
  dl_ebitda:                'dívida líquida / EBITDA',
  ebitda:                   'EBITDA',
  ebit:                     'EBIT',
  cobertura_juros:          'cobertura de juros',
  relacao_ct_cp:            'relação CT/CP',
  grau_endividamento:       'grau de endividamento',
  crescimento_receita:      'crescimento de receita',
  crescimento_clientes:     'crescimento de clientes',
  crescimento_estoques:     'crescimento de estoques',
  crescimento_divida:       'crescimento de dívida',
  crescimento_pl:           'crescimento de PL',
  margem_ebitda:            'margem EBITDA',
  margem_liquida:           'margem líquida',
  roe:                      'ROE',
  roa:                      'ROA',
  roic:                     'ROIC',
  divida_cp_pct:            'concentração CP da dívida',
  ciclo_financeiro:         'ciclo financeiro',
  endiv_bancario_pl:        'endividamento bancário/PL',
  divida_financeira_tot:    'dívida financeira total',
  divida_liquida:           'dívida líquida',
  // Novos indicadores (P03 extensão)
  margem_bruta:             'margem bruta',
  margem_ebit:              'margem EBIT',
  cobertura_ebitda_df:      'cobertura EBITDA / DF',
  ativo_clientes:           'clientes (ativo)',
  ativo_estoques:           'estoques (ativo)',
  ativo_imobilizado:        'imobilizado + intangível',
  capital_giro:             'capital de giro (CDG)',
  ncg:                      'necessidade de capital de giro',
  saldo_tesouraria:         'saldo de tesouraria',
  imobilizacao_pl:          'imobilização do PL',
  imobilizacao_rec_perm:    'imobilização dos rec. permanentes',
  imob_ativo_pct:           'imobilização do ativo',
  pm_tributos:              'prazo médio de tributos',
};

function indLabel(ind: string): string {
  return INDICADOR_LABEL[ind] ?? ind.replaceAll('_', ' ');
}

/* ─── Configuração visual por severidade ────────────────────────────────── */

type SevConfig = {
  heading:      string;
  Icon:         React.ComponentType<{ size?: number; weight?: 'fill' | 'regular' | 'bold'; className?: string }>;
  dotCls:       string;
  headingCls:   string;
  sectionCls:   string;
  badgeCls:     string;
};

const SEV_CFG: Record<Severidade, SevConfig> = {
  critico: {
    heading:    'Alertas críticos',
    Icon:       WarningCircleIcon,
    dotCls:     'bg-red-500',
    headingCls: 'text-red-600 dark:text-red-400',
    sectionCls: 'border-red-100 dark:border-red-900/40',
    badgeCls:   'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300 ring-red-100 dark:ring-red-900/40',
  },
  atencao: {
    heading:    'Pontos de atenção',
    Icon:       WarningIcon,
    dotCls:     'bg-amber-400',
    headingCls: 'text-amber-600 dark:text-amber-400',
    sectionCls: 'border-amber-100 dark:border-amber-900/40',
    badgeCls:   'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 ring-amber-100 dark:ring-amber-900/40',
  },
  positivo: {
    heading:    'Indicadores positivos',
    Icon:       CheckCircleIcon,
    dotCls:     'bg-emerald-500',
    headingCls: 'text-emerald-600 dark:text-emerald-400',
    sectionCls: 'border-emerald-100 dark:border-emerald-900/40',
    badgeCls:   'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 ring-emerald-100 dark:ring-emerald-900/40',
  },
};

/* ─── Sub-componentes ────────────────────────────────────────────────────── */

interface AlertaItemProps {
  alerta: Alerta;
  cfg:    SevConfig;
}

function AlertaItem({ alerta, cfg }: AlertaItemProps) {
  const subcategoria = indLabel(alerta.indicador);
  const inferido     = alerta.regraOk === 0;

  return (
    <li className="flex items-start gap-3 py-3">
      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', cfg.dotCls)} />
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm text-foreground leading-snug', inferido && 'opacity-70')}>
          {alerta.mensagem}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground capitalize">
          {alerta.categoria}
          <span className="mx-1 opacity-50">·</span>
          {subcategoria}
          {inferido && (
            <span className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset bg-muted text-muted-foreground ring-border">
              inferido
            </span>
          )}
        </p>
      </div>
      <span className={cn(
        'mt-0.5 shrink-0 self-start rounded px-1.5 py-0.5 text-[10px] font-mono font-medium ring-1 ring-inset',
        cfg.badgeCls,
      )}>
        {alerta.codigoRegra}
      </span>
    </li>
  );
}

interface AlertaSectionProps {
  severidade: Severidade;
  itens:      Alerta[];
}

function AlertaSection({ severidade, itens }: AlertaSectionProps) {
  if (itens.length === 0) return null;
  const cfg = SEV_CFG[severidade];
  const { Icon } = cfg;

  return (
    <section className={cn('rounded-lg border p-4', cfg.sectionCls)}>
      <div className={cn('mb-1 flex items-center gap-2 text-sm font-semibold', cfg.headingCls)}>
        <Icon size={16} weight="fill" />
        {cfg.heading}
        <span className="ml-auto text-xs font-normal opacity-70">{itens.length}</span>
      </div>
      <ul className="divide-y divide-border/60">
        {itens.map(a => (
          <AlertaItem key={a.id} alerta={a} cfg={cfg} />
        ))}
      </ul>
    </section>
  );
}

/* ─── Barra de resumo ────────────────────────────────────────────────────── */

interface SummaryBarProps {
  criticos:  number;
  atencao:   number;
  positivos: number;
}

function SummaryBar({ criticos, atencao, positivos }: SummaryBarProps) {
  const total = criticos + atencao + positivos;
  if (total === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {criticos > 0 && (
        <span className="flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-100 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-900/40">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
          {criticos} crítico{criticos !== 1 ? 's' : ''}
        </span>
      )}
      {atencao > 0 && (
        <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-100 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900/40">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          {atencao} atenção
        </span>
      )}
      {positivos > 0 && (
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900/40">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {positivos} positivo{positivos !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}

/* ─── Componente principal ───────────────────────────────────────────────── */

interface AlertasProps {
  alertas:   Alerta[];
  exercicio: number;
}

export function Alertas({ alertas, exercicio }: AlertasProps) {
  const filtrados = exercicio > 0
    ? alertas.filter(a => a.exercicio === exercicio)
    : alertas;

  const criticos  = filtrados.filter(a => a.severidade === 'critico');
  const atencao   = filtrados.filter(a => a.severidade === 'atencao');
  const positivos = filtrados.filter(a => a.severidade === 'positivo');

  if (filtrados.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
        <BellIcon size={36} />
        <p className="text-sm">Nenhum alerta gerado para o exercício {exercicio || 'selecionado'}.</p>
        <p className="text-xs opacity-70">Clique em Processar para calcular indicadores e regras.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <SummaryBar
        criticos={criticos.length}
        atencao={atencao.length}
        positivos={positivos.length}
      />

      <AlertaSection severidade="critico"  itens={criticos}  />
      <AlertaSection severidade="atencao"  itens={atencao}   />
      <AlertaSection severidade="positivo" itens={positivos} />
    </div>
  );
}
