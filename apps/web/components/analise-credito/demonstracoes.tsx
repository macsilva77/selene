'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowClockwiseIcon,
  DownloadSimpleIcon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { formatCNPJ } from '@/lib/format';
import {
  analiseCreditoApi,
  type EmpresaResumo,
  type DemonstracaoRow,
} from '@/lib/analise-credito-api';

type Aba = 'balanco' | 'dre';

function formatCurrency(value: string | number | null | undefined): string {
  if (value == null) return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.abs(n));
}

export function DemonstracoesFinanceiras() {
  const [empresas, setEmpresas]               = useState<EmpresaResumo[]>([]);
  const [cnpj, setCnpj]                       = useState('');
  const [exercicios, setExercicios]           = useState<number[]>([]);
  const [exercicio, setExercicio]             = useState<number | null>(null);
  const [aba, setAba]                         = useState<Aba>('balanco');
  const [contaRef, setContaRef]               = useState('');
  const [contaRefAtiva, setContaRefAtiva]     = useState('');
  const [apenasComValores, setApenasComValores]     = useState(false);
  const [mostrarAnoAnterior, setMostrarAnoAnterior] = useState(false);
  const [registros, setRegistros]             = useState<DemonstracaoRow[]>([]);
  const [registrosAnt, setRegistrosAnt]       = useState<DemonstracaoRow[]>([]);
  const [loading, setLoading]                 = useState(false);
  const [erro, setErro]                       = useState<string | null>(null);

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
    } catch {
      setErro('Erro ao carregar demonstrações financeiras');
    } finally {
      setLoading(false);
    }
  }, [cnpj, exercicio, aba, contaRefAtiva, mostrarAnoAnterior]);

  useEffect(() => { void fetchDados(); }, [fetchDados]);

  const registrosFiltrados = useMemo(() => {
    if (!apenasComValores) return registros;
    return registros.filter(r => Number(r.valor) !== 0);
  }, [registros, apenasComValores]);

  const antMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of registrosAnt) m.set(r.linhaCodigo, r.valor);
    return m;
  }, [registrosAnt]);

  function handleFiltrar() {
    setContaRefAtiva(contaRef.trim());
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-end bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex-1 min-w-[260px]">
          <label className="block text-xs text-slate-500 mb-1">Empresa</label>
          <select
            value={cnpj}
            onChange={e => setCnpj(e.target.value)}
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
        <button
          onClick={handleFiltrar}
          className="px-4 py-2 text-sm font-medium bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors"
        >
          Filtrar
        </button>
        {contaRefAtiva && (
          <button
            onClick={() => { setContaRef(''); setContaRefAtiva(''); }}
            className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
          >
            Limpar
          </button>
        )}
      </div>

      {erro && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {erro}
        </div>
      )}

      {/* Card principal */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">

        {/* Abas */}
        <div className="flex border-b border-slate-200">
          {(['balanco', 'dre'] as Aba[]).map(a => (
            <button
              key={a}
              onClick={() => setAba(a)}
              className={cn(
                'px-5 py-3 text-sm font-medium border-b-2 transition-colors',
                aba === a
                  ? 'border-slate-800 text-slate-800'
                  : 'border-transparent text-slate-500 hover:text-slate-700',
              )}
            >
              {a === 'balanco' ? 'Balanço Patrimonial' : 'DRE'}
            </button>
          ))}
        </div>

        {/* Controles */}
        <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
          <div className="flex items-center gap-4 text-sm text-slate-600">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={apenasComValores}
                onChange={e => setApenasComValores(e.target.checked)}
                className="rounded"
              />
              Visualizar apenas itens com valores
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={mostrarAnoAnterior}
                onChange={e => setMostrarAnoAnterior(e.target.checked)}
                className="rounded"
              />
              Mostrar Ano Anterior
            </label>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 mr-1">Anos:</span>
            {exercicios.map(ano => (
              <button
                key={ano}
                onClick={() => setExercicio(ano)}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium rounded border transition-colors',
                  ano === exercicio
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50',
                )}
              >
                {ano}
              </button>
            ))}
            <button
              onClick={() => void fetchDados()}
              disabled={loading}
              title="Recarregar"
              className="ml-1 p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-200 rounded transition-colors disabled:opacity-40"
            >
              <ArrowClockwiseIcon className={cn('w-4 h-4', loading && 'animate-spin')} />
            </button>
            <button
              title="Exportar"
              className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-200 rounded transition-colors"
            >
              <DownloadSimpleIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabela */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-medium text-slate-500 bg-slate-50 border-b border-slate-200">
                <th className="w-8 px-2 py-2.5" />
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
                <tr>
                  <td colSpan={mostrarAnoAnterior ? 5 : 4} className="py-10 text-center text-slate-400">
                    Carregando...
                  </td>
                </tr>
              )}

              {!loading && registrosFiltrados.length === 0 && (
                <tr>
                  <td colSpan={mostrarAnoAnterior ? 5 : 4} className="py-12 text-center text-slate-400">
                    {!exercicio ? 'Selecione uma empresa.' : 'Nenhum dado encontrado para este exercício.'}
                  </td>
                </tr>
              )}

              {!loading && registrosFiltrados.map(row => {
                const valor    = Number(row.valor);
                const valorAnt = antMap.has(row.linhaCodigo) ? Number(antMap.get(row.linhaCodigo)) : null;
                const isGrupo  = row.haFilhos;
                const indent   = (row.nivel - 1) * 14;

                return (
                  <tr
                    key={row.linhaCodigo}
                    className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-2 text-center w-8">
                      <span className={cn('text-xs select-none', isGrupo ? 'text-slate-500 font-bold' : 'text-slate-300')}>
                        {isGrupo ? '–' : '-'}
                      </span>
                    </td>

                    <td className="py-1.5 pr-4" style={{ paddingLeft: `${16 + indent}px` }}>
                      <span className={cn(
                        row.nivel === 1            && 'font-bold text-slate-900',
                        row.nivel === 2            && 'font-semibold text-slate-800',
                        row.nivel === 3 && isGrupo && 'font-semibold text-slate-700',
                        row.nivel >= 3 && !isGrupo && 'text-slate-600',
                        row.nivel >= 5             && 'text-slate-500',
                      )}>
                        {row.descricao}
                      </span>
                    </td>

                    <td className="px-4 py-1.5 text-right">
                      {valor === 0
                        ? <span className="text-slate-400">-</span>
                        : <span className={cn('tabular-nums', row.nivel <= 2 ? 'font-semibold text-slate-800' : 'text-slate-700')}>
                            {formatCurrency(valor)}
                          </span>
                      }
                    </td>

                    {mostrarAnoAnterior && (
                      <td className="px-4 py-1.5 text-right text-slate-400">
                        {valorAnt === null || valorAnt === 0
                          ? <span className="text-slate-300">-</span>
                          : <span className="tabular-nums">{formatCurrency(valorAnt)}</span>
                        }
                      </td>
                    )}

                    <td className="px-4 py-1.5 text-right">
                      <span className={cn(
                        'text-xs font-medium',
                        row.natureza === 'DEVEDOR' ? 'text-blue-600' : 'text-emerald-600',
                      )}>
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
