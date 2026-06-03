'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowClockwiseIcon, DownloadSimpleIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { formatCNPJ } from '@/lib/format';
import {
  analiseCreditoApi,
  type EmpresaResumo,
  type DemonstracaoRow,
} from '@/lib/analise-credito-api';

type Aba = 'balanco' | 'dre';

interface Liquidez {
  liquidez_corrente: number | null;
  liquidez_seca:     number | null;
  liquidez_imediata: number | null;
  liquidez_geral:    number | null;
}

function computeLiquidez(rows: DemonstracaoRow[]): Liquidez {
  const byCode = (cod: string) => Math.abs(Number(rows.find(r => r.linhaCodigo === cod)?.valor ?? 0));
  const byDesc = (kw: string) => {
    const r = rows.find(row => row.descricao.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(kw) && row.haFilhos);
    return Math.abs(Number(r?.valor ?? 0));
  };
  const get = (code: string, kw: string) => { const v = byCode(code); return v !== 0 ? v : byDesc(kw); };

  const ac    = get('1.01',    'ativo circulante');
  const pc    = get('2.01',    'passivo circulante');
  const pnc   = get('2.02',    'passivo nao circulante');
  const caixa = get('1.01.01', 'disponibilidade');
  const estoq = get('1.01.03', 'estoque');
  const rlp   = get('1.02.01', 'realizavel a longo');

  const div = (a: number, b: number) => (b !== 0 ? a / b : null);
  return {
    liquidez_corrente: div(ac, pc),
    liquidez_seca:     div(ac - estoq, pc),
    liquidez_imediata: div(caixa, pc),
    liquidez_geral:    div(ac + rlp, pc + pnc),
  };
}

function fmtIndice(v: number | null): string {
  if (v === null) return '–';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCurrency(value: string | number | null | undefined): string {
  if (value == null) return '—';
  const n = Number(value);
  if (Number.isNaN(n) || n === 0) return '-';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.abs(n));
}

// Retorna os códigos dos ancestrais de um linhaCodigo
function ancestrais(cod: string): string[] {
  const parts = cod.split('.');
  const result: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    result.push(parts.slice(0, i).join('.'));
  }
  return result;
}

export function DemonstracoesFinanceiras() {
  const [empresas, setEmpresas]           = useState<EmpresaResumo[]>([]);
  const [cnpj, setCnpj]                   = useState('');
  const [exercicios, setExercicios]       = useState<number[]>([]);
  const [exercicio, setExercicio]         = useState<number | null>(null);
  const [aba, setAba]                     = useState<Aba>('balanco');
  const [contaRef, setContaRef]           = useState('');
  const [contaRefAtiva, setContaRefAtiva] = useState('');
  const [apenasComValores, setApenasComValores]     = useState(false);
  const [mostrarAnoAnterior, setMostrarAnoAnterior] = useState(false);
  const [registros, setRegistros]         = useState<DemonstracaoRow[]>([]);
  const [registrosAnt, setRegistrosAnt]   = useState<DemonstracaoRow[]>([]);
  const [loading, setLoading]             = useState(false);
  const [erro, setErro]                   = useState<string | null>(null);

  // Conjunto de códigos expandidos — nível 1 e 2 abertos por padrão
  const [expandidos, setExpandidos]       = useState<Set<string>>(new Set());

  useEffect(() => {
    analiseCreditoApi.listarEmpresas().then(data => {
      setEmpresas(data);
      if (data.length > 0) setCnpj(data[0].cnpj);
    }).catch(() => setErro('Erro ao carregar empresas'));
  }, []);

  useEffect(() => {
    if (!cnpj) return;
    setExercicios([]);
    setExercicio(null);
    analiseCreditoApi.exercicios(cnpj).then(anos => {
      setExercicios(anos);
      if (anos.length > 0) setExercicio(anos[0]);
    }).catch(() => setErro('Erro ao carregar exercícios'));
  }, [cnpj]);

  const fetchDados = useCallback(async () => {
    if (!cnpj || !exercicio) return;
    setLoading(true);
    setErro(null);
    try {
      const [regs, regsAnt] = await Promise.all([
        analiseCreditoApi.demonstracoes(cnpj, aba, exercicio, contaRefAtiva || undefined),
        mostrarAnoAnterior
          ? analiseCreditoApi.demonstracoes(cnpj, aba, exercicio - 1, contaRefAtiva || undefined)
          : Promise.resolve([]),
      ]);
      setRegistros(regs);
      setRegistrosAnt(regsAnt);
      // Expande nível 1 e 2 automaticamente ao carregar
      const autoExp = new Set<string>(
        regs.filter(r => r.haFilhos && r.nivel <= 2).map(r => r.linhaCodigo),
      );
      setExpandidos(autoExp);
    } catch {
      setErro('Erro ao carregar demonstrações financeiras');
    } finally {
      setLoading(false);
    }
  }, [cnpj, exercicio, aba, contaRefAtiva, mostrarAnoAnterior]);

  useEffect(() => { void fetchDados(); }, [fetchDados]);

  function toggleExpansao(cod: string) {
    setExpandidos(prev => {
      const next = new Set(prev);
      if (next.has(cod)) next.delete(cod); else next.add(cod);
      return next;
    });
  }

  function expandirTudo() {
    setExpandidos(new Set(registros.filter(r => r.haFilhos).map(r => r.linhaCodigo)));
  }

  function recolherTudo() {
    setExpandidos(new Set(registros.filter(r => r.haFilhos && r.nivel <= 1).map(r => r.linhaCodigo)));
  }

  // Filtra por visibilidade (todos os ancestrais devem estar expandidos)
  const registrosVisiveis = useMemo(() => {
    return registros.filter(row => {
      if (apenasComValores && Number(row.valor) === 0 && !row.haFilhos) return false;
      return ancestrais(row.linhaCodigo).every(a => expandidos.has(a));
    });
  }, [registros, expandidos, apenasComValores]);

  const antMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of registrosAnt) m.set(r.linhaCodigo, r.valor);
    return m;
  }, [registrosAnt]);

  function handleFiltrar() { setContaRefAtiva(contaRef.trim()); }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-end bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex-1 min-w-[260px]">
          <label className="block text-xs text-slate-500 mb-1">Empresa</label>
          <select
            value={cnpj}
            onChange={e => setCnpj(e.target.value)}
            aria-label="Selecionar empresa"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {empresas.length === 0 && <option value="">Carregando...</option>}
            {empresas.map(e => (
              <option key={e.cnpj} value={e.cnpj}>
                {formatCNPJ(e.cnpj)} — {e.razaoSocial}
              </option>
            ))}
          </select>
        </div>
        <div className="w-44">
          <label className="block text-xs text-slate-500 mb-1">Conta referencial</label>
          <input
            type="text"
            placeholder="ex.: 1.01.01"
            value={contaRef}
            onChange={e => setContaRef(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleFiltrar()}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button type="button" onClick={handleFiltrar}
          className="px-4 py-2 text-sm font-medium bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors">
          Filtrar
        </button>
        {contaRefAtiva && (
          <button type="button" onClick={() => { setContaRef(''); setContaRefAtiva(''); }}
            className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors">
            Limpar
          </button>
        )}
      </div>

      {erro && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{erro}</div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Abas */}
        <div className="flex border-b border-slate-200">
          {(['balanco', 'dre'] as Aba[]).map(a => (
            <button type="button" key={a} onClick={() => setAba(a)}
              className={cn('px-5 py-3 text-sm font-medium border-b-2 transition-colors',
                aba === a ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700')}>
              {a === 'balanco' ? 'Balanço Patrimonial' : 'DRE'}
            </button>
          ))}
        </div>

        {/* Controles */}
        <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
          <div className="flex items-center gap-4 text-sm text-slate-600">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={apenasComValores}
                onChange={e => setApenasComValores(e.target.checked)} className="rounded" />
              Visualizar apenas itens com valores
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={mostrarAnoAnterior}
                onChange={e => setMostrarAnoAnterior(e.target.checked)} className="rounded" />
              Mostrar Ano Anterior
            </label>
            <button type="button" onClick={expandirTudo}
              className="text-xs text-slate-500 underline hover:text-slate-700">
              Expandir tudo
            </button>
            <button type="button" onClick={recolherTudo}
              className="text-xs text-slate-500 underline hover:text-slate-700">
              Recolher
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 mr-1">Anos:</span>
            {exercicios.map(ano => (
              <button type="button" key={ano} onClick={() => setExercicio(ano)}
                className={cn('px-2.5 py-1 text-xs font-medium rounded border transition-colors',
                  ano === exercicio ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50')}>
                {ano}
              </button>
            ))}
            <button type="button" onClick={() => void fetchDados()} disabled={loading} title="Recarregar"
              className="ml-1 p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-200 rounded transition-colors disabled:opacity-40">
              <ArrowClockwiseIcon className={cn('w-4 h-4', loading && 'animate-spin')} />
            </button>
            <button type="button" title="Exportar"
              className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-200 rounded transition-colors">
              <DownloadSimpleIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Índices de Liquidez — aparece somente na aba Balanço */}
        {aba === 'balanco' && registros.length > 0 && (() => {
          const liq = computeLiquidez(registros);
          const items = [
            { label: 'Liquidez Corrente',  formula: 'AC / PC',              valor: liq.liquidez_corrente },
            { label: 'Liquidez Seca',      formula: '(AC − Estoques) / PC', valor: liq.liquidez_seca },
            { label: 'Liquidez Imediata',  formula: 'Disponível / PC',      valor: liq.liquidez_imediata },
            { label: 'Liquidez Geral',     formula: '(AC + RLP) / (PC + ELP)', valor: liq.liquidez_geral },
          ];
          return (
            <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
              <p className="text-xs font-semibold text-blue-700 mb-2">Índices de Liquidez</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {items.map(item => (
                  <div key={item.label} className="bg-white rounded-lg border border-blue-100 px-3 py-2">
                    <p className="text-[10px] text-slate-500 leading-tight">{item.label}</p>
                    <p className="text-[9px] text-slate-400 leading-tight mb-1">{item.formula}</p>
                    <p className={cn('text-base font-bold tabular-nums',
                      item.valor === null ? 'text-slate-400' :
                      item.valor >= 1 ? 'text-emerald-600' : 'text-red-500')}>
                      {fmtIndice(item.valor)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Tabela */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-medium text-slate-500 bg-slate-50 border-b border-slate-200">
                <th className="w-8 px-2 py-2.5" aria-label="Expandir/recolher" />
                <th className="text-left px-4 py-2.5">Descrição da Conta</th>
                <th className="text-right px-4 py-2.5 w-52">Saldo Final</th>
                {mostrarAnoAnterior && (
                  <th className="text-right px-4 py-2.5 w-52 text-slate-400">
                    Ano Anterior ({exercicio ? exercicio - 1 : '—'})
                  </th>
                )}
                <th className="text-right px-4 py-2.5 w-28">Natureza</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={mostrarAnoAnterior ? 5 : 4} className="py-10 text-center text-slate-400">Carregando...</td></tr>
              )}
              {!loading && registrosVisiveis.length === 0 && (
                <tr><td colSpan={mostrarAnoAnterior ? 5 : 4} className="py-12 text-center text-slate-400">
                  {!exercicio ? 'Selecione uma empresa.' : 'Nenhum dado encontrado para este exercício.'}
                </td></tr>
              )}
              {!loading && registrosVisiveis.map(row => {
                const valor    = Number(row.valor);
                const valorAnt = antMap.has(row.linhaCodigo) ? Number(antMap.get(row.linhaCodigo)) : null;
                const isGrupo  = row.haFilhos;
                const expandido = expandidos.has(row.linhaCodigo);
                const NIVEL_PL = ['pl-4','pl-8','pl-12','pl-16','pl-20','pl-24'] as const;
                const plClass  = NIVEL_PL[Math.min(row.nivel - 1, 5)];

                return (
                  <tr key={row.linhaCodigo}
                    className={cn('border-b border-slate-100 transition-colors',
                      isGrupo ? 'hover:bg-slate-50 cursor-pointer' : 'hover:bg-slate-50')}
                    onClick={isGrupo ? () => toggleExpansao(row.linhaCodigo) : undefined}>

                    {/* Indicador expand/collapse */}
                    <td className="px-2 text-center w-8">
                      <span className={cn('text-xs select-none font-mono',
                        isGrupo ? 'text-slate-500 font-bold' : 'text-slate-300')}>
                        {isGrupo ? (expandido ? '–' : '+') : '-'}
                      </span>
                    </td>

                    {/* Descrição */}
                    <td className={cn('py-1.5 pr-4', plClass)}>
                      <span className={cn(
                        row.nivel === 1             && 'font-bold text-slate-900',
                        row.nivel === 2             && 'font-semibold text-slate-800',
                        row.nivel === 3 && isGrupo  && 'font-semibold text-slate-700',
                        row.nivel >= 3 && !isGrupo  && 'text-slate-600',
                        row.nivel >= 5              && 'text-slate-500',
                      )}>
                        {row.descricao}
                      </span>
                    </td>

                    {/* Saldo Final */}
                    <td className="px-4 py-1.5 text-right">
                      {valor === 0
                        ? <span className="text-slate-400">-</span>
                        : <span className={cn('tabular-nums',
                            row.nivel <= 2 ? 'font-semibold text-slate-800' : 'text-slate-700')}>
                            {formatCurrency(valor)}
                          </span>
                      }
                    </td>

                    {/* Ano Anterior */}
                    {mostrarAnoAnterior && (
                      <td className="px-4 py-1.5 text-right text-slate-400">
                        {valorAnt === null || valorAnt === 0
                          ? <span className="text-slate-300">-</span>
                          : <span className="tabular-nums">{formatCurrency(valorAnt)}</span>
                        }
                      </td>
                    )}

                    {/* Natureza */}
                    <td className="px-4 py-1.5 text-right">
                      <span className={cn('text-xs font-medium',
                        row.natureza === 'DEVEDOR' ? 'text-blue-600' : 'text-emerald-600')}>
                        {row.natureza}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
