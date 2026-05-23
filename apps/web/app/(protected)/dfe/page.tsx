'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowClockwiseIcon,
  PlusIcon,
  WarningIcon,
  CheckCircleIcon,
  ClockIcon,
  XIcon,
  CloudArrowDownIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
  ArrowsClockwiseIcon,
  SealCheckIcon,
  InfoIcon,
  FileMagnifyingGlassIcon,
  MagnifyingGlassIcon,
  WifiHighIcon,
  WifiSlashIcon,
  ClockCounterClockwiseIcon,
  GearIcon,
  ChartLineUpIcon,
  CaretDownIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { DataTable } from '@/components/ui/table';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/api';
import { useToast, ToastContainer } from '@/components/ui/toast';

/* ─────────────────────────────────────────────────────────────────── */
/* Types                                                               */
/* ─────────────────────────────────────────────────────────────────── */

interface DfeControle {
  ultimoNsu: string;
  maxNsu: string;
  ultimaConsulta: string | null;
  proximaConsulta: string | null;
  emProcessamento: boolean;
  totalDocBaixados: number;
  totalLotes: number;
  totalErros: number;
  errosConsecutivos: number;
  ultimoErro: string | null;
  ultimoErroEm: string | null;
  ultimoLote: { cStat: string; xMotivo: string; iniciadoEm: string } | null;
}

interface DfeCertificado {
  id: string;
  razaoSocial: string;
  cnpjCert: string;
  dataValidade: string;
  status: string;
}

interface DfeConfig {
  id: string;
  cnpj: string;
  nome: string | null;
  nomeFantasia: string | null;
  cUf: number;
  tpAmb: 1 | 2;
  ativo: boolean;
  horarioCaptura: string;
  intervaloMinutos: number;
  certificado: DfeCertificado | null;
  controle: DfeControle | null;
}

interface DfeLote {
  id: string;
  cnpj: string;
  nsuEnviado: string;
  cStat: string;
  xMotivo: string;
  ultNsuRecebido: string;
  maxNsuRecebido: string;
  qtdDocumentos: number;
  status: string;
  duracaoMs: number | null;
  iniciadoEm: string;
  finalizadoEm: string | null;
  erroMensagem: string | null;
}

interface DfeVarredura {
  status: 'ATIVA' | 'PAUSADA' | 'CONCLUIDA' | 'ERRO';
  nsuInicio: string;
  nsuFim: string;
  nsuAtual: string;
  totalConsultado: number;
  totalRecuperado: number;
  percentual: number;
  estimativaConclusao: string | null;
  iniciadoEm: string | null;
  concluidoEm: string | null;
  ultimoErro: string | null;
}

interface Certificado { id: string; cnpj: string; razaoSocial: string; validade: string; status: string; }
interface Empresa { id: string; cnpj: string; nome: string; nomeFantasia?: string; uf?: string; }
interface FormState {
  cnpj: string; tpAmb: 1 | 2; certificadoId: string;
  horarioCaptura: string; intervaloMinutos: number;
}

/* ─────────────────────────────────────────────────────────────────── */
/* Helpers                                                             */
/* ─────────────────────────────────────────────────────────────────── */

const UF_MAP: Record<number, string> = {
  12:'AC',27:'AL',16:'AP',13:'AM',29:'BA',23:'CE',53:'DF',32:'ES',52:'GO',
  21:'MA',51:'MT',50:'MS',31:'MG',15:'PA',25:'PB',41:'PR',26:'PE',22:'PI',
  33:'RJ',24:'RN',43:'RS',11:'RO',14:'RR',42:'SC',35:'SP',28:'SE',17:'TO',
};

const INTERVALO_OPTIONS = [
  { label: '5 min', value: 5 }, { label: '15 min', value: 15 },
  { label: '30 min', value: 30 }, { label: '1 hora', value: 60 },
  { label: '2 horas', value: 120 }, { label: '4 horas', value: 240 },
  { label: '6 horas', value: 360 }, { label: '12 horas', value: 720 },
  { label: '24 horas', value: 1440 },
];

const CSTAT_INFO: Record<string, { descricao: string; tipo: 'ok' | 'info' | 'warn' | 'err' }> = {
  '107': { descricao: 'Serviço em operação', tipo: 'info' },
  '108': { descricao: 'Serviço em manutenção', tipo: 'warn' },
  '109': { descricao: 'Serviço indisponível', tipo: 'err' },
  '137': { descricao: 'Sem novos documentos', tipo: 'info' },
  '138': { descricao: 'Documentos localizados', tipo: 'ok' },
  '217': { descricao: 'NF-e não encontrada', tipo: 'warn' },
  '236': { descricao: 'Chave — DV inválido', tipo: 'warn' },
  '252': { descricao: 'Ambiente divergente', tipo: 'warn' },
  '472': { descricao: 'CPF divergente do certificado', tipo: 'err' },
  '489': { descricao: 'CNPJ inválido', tipo: 'err' },
  '490': { descricao: 'CPF inválido', tipo: 'err' },
  '589': { descricao: 'NSU superior ao máximo', tipo: 'warn' },
  '593': { descricao: 'CNPJ-Base divergente do certificado', tipo: 'err' },
  '614': { descricao: 'UF da chave inválida', tipo: 'warn' },
  '632': { descricao: 'NF-e fora do prazo (90 dias)', tipo: 'warn' },
  '640': { descricao: 'CNPJ sem permissão para esta NF-e', tipo: 'warn' },
  '656': { descricao: 'Consumo Indevido — aguardar 1 hora', tipo: 'err' },
};

function cstatBadge(cStat: string): { label: string; descricao: string; cls: string; tipo: 'ok' | 'info' | 'warn' | 'err' } {
  const info = CSTAT_INFO[cStat];
  const tipo = info?.tipo ?? 'warn';
  const descricao = info?.descricao ?? 'Código desconhecido';
  const clsMap: Record<string, string> = {
    ok:   'bg-emerald-50 text-emerald-700',
    info: 'bg-slate-100 text-slate-600',
    warn: 'bg-amber-50 text-amber-700',
    err:  'bg-red-50 text-red-700',
  };
  return { label: cStat, descricao, cls: clsMap[tipo], tipo };
}

function maskCnpj(v: string | null | undefined) {
  const raw = (v ?? '').replace(/[.\-\/\s]/g, '').slice(0, 14);
  if (/^\d{14}$/.test(raw))
    return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8, 12)}-${raw.slice(12)}`;
  return raw;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDateTimeSec(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function nsuInt(nsu: string) { return Number.parseInt(nsu ?? '0', 10); }

function pendentesNsu(c: DfeControle | null) {
  if (!c) return 0;
  return Math.max(0, nsuInt(c.maxNsu) - nsuInt(c.ultimoNsu));
}

function razaoSocialSemCnpj(razaoSocial: string) {
  const idx = razaoSocial.lastIndexOf(':');
  if (idx > 0 && /^\d{14}$/.test(razaoSocial.slice(idx + 1))) return razaoSocial.slice(0, idx).trim();
  return razaoSocial;
}

/* ─────────────────────────────────────────────────────────────────── */
/* Drawer lateral (detalhe da config)                                  */
/* ─────────────────────────────────────────────────────────────────── */

function ConfigDrawer({
  config,
  onClose,
  onToggle,
  onSync,
  onDownload,
  onDelete,
  syncingId,
  downloadingId,
}: Readonly<{
  config: DfeConfig;
  onClose: () => void;
  onToggle: (id: string) => void;
  onSync: (id: string) => void;
  onDownload: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  syncingId: string | null;
  downloadingId: string | null;
}>) {
  const [lotes, setLotes] = useState<DfeLote[]>([]);
  const [loadingLotes, setLoadingLotes] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [lotePage, setLotePage] = useState(1);
  const [varredura, setVarredura] = useState<DfeVarredura | null | 'loading'>('loading');
  const [confirmarExcluir, setConfirmarExcluir] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const LIMIT = 15;

  const c = config.controle;
  const pendentes = pendentesNsu(c);
  const temErro = (c?.errosConsecutivos ?? 0) > 0;

  const carregarLotes = useCallback(async (p: number) => {
    setLoadingLotes(true);
    try {
      const res = await api.get(`/dfe/lotes?configId=${config.id}&limit=${LIMIT}&page=${p}`);
      const data = res.data as { data: DfeLote[]; meta: { total: number } };
      setLotes((prev) => p === 1 ? data.data : [...prev, ...data.data]);
      setHasMore(p * LIMIT < data.meta.total);
      setLotePage(p);
    } finally {
      setLoadingLotes(false);
    }
  }, [config.id]);

  useEffect(() => { void carregarLotes(1); }, [carregarLotes]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const buscar = () => {
      api.get(`/dfe/${config.id}/varredura`)
        .then((res) => {
          if (cancelled) return;
          const data = res.data as DfeVarredura | null;
          setVarredura(data);
          // Repõe polling a cada 10s enquanto ativa
          if (data?.status === 'ATIVA') {
            timer = setTimeout(buscar, 10_000);
          }
        })
        .catch(() => { if (!cancelled) setVarredura(null); });
    };

    setVarredura('loading');
    buscar();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [config.id]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]" onClick={onClose} />
      <div className="fixed top-0 right-0 z-50 h-full w-[480px] max-w-[92vw] bg-card shadow-2xl flex flex-col border-l border-border overflow-hidden">

        {/* ── Header ── */}
        <div className="px-6 py-5 border-b border-border shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  {config.ativo
                    ? <WifiHighIcon size={15} className="text-primary" weight="fill" />
                    : <WifiSlashIcon size={15} className="text-muted-foreground" weight="fill" />}
                </div>
                <div className="flex flex-col leading-tight">
                  {config.certificado?.razaoSocial && (
                    <span className="text-sm font-medium text-foreground truncate max-w-64">
                      {razaoSocialSemCnpj(config.certificado.razaoSocial)}
                    </span>
                  )}
                  <span className="text-sm font-medium text-foreground font-mono">
                    {maskCnpj(config.cnpj)}
                  </span>
                </div>
                {/* Status badge */}
                {!config.ativo ? (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-muted text-muted-foreground border-border shrink-0">Inativo</span>
                ) : temErro ? (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-red-100 text-red-700 border-red-200 shrink-0">Erro</span>
                ) : c?.emProcessamento ? (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-blue-50 text-blue-700 border-blue-200 shrink-0 flex items-center gap-1">
                    <ArrowsClockwiseIcon size={10} className="animate-spin" />Processando
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-emerald-100 text-emerald-700 border-emerald-200 shrink-0">Ativo</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {config.tpAmb === 1 ? 'Produção' : 'Homologação'} · UF {UF_MAP[config.cUf] ?? config.cUf}
              </p>
            </div>
            <button type="button" title="Fechar" onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0">
              <XIcon size={16} />
            </button>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto">

          {/* Seção: Configuração */}
          <div className="px-6 py-5 border-b border-border/60">
            <div className="flex items-center gap-2 mb-4">
              <GearIcon size={14} className="text-primary" weight="fill" />
              <span className="text-[11px] font-bold text-primary uppercase tracking-widest">Configuração</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Ambiente</p>
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${config.tpAmb === 1 ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'}`}>
                  {config.tpAmb === 1 ? 'Produção' : 'Homologação'}
                </span>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">UF</p>
                <p className="font-medium text-foreground">{UF_MAP[config.cUf] ?? config.cUf}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Periodicidade</p>
                <p className="font-medium text-foreground">
                  {INTERVALO_OPTIONS.find((o) => o.value === config.intervaloMinutos)?.label ?? `${config.intervaloMinutos} min`}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Horário de início</p>
                <p className="font-medium text-foreground">{config.horarioCaptura}</p>
              </div>
            </div>
            {config.certificado ? (
              <div className="mt-3 p-3 rounded-lg border border-border bg-muted/20 flex items-center gap-2">
                <SealCheckIcon size={13} className="text-emerald-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Validade do certificado</span>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{fmtDate(config.certificado.dataValidade)}</p>
                </div>
              </div>
            ) : null}
          </div>

          {/* Seção: Monitoramento */}
          <div className="px-6 py-5 border-b border-border/60">
            <div className="flex items-center gap-2 mb-4">
              <ChartLineUpIcon size={14} className="text-primary" weight="fill" />
              <span className="text-[11px] font-bold text-primary uppercase tracking-widest">Monitoramento</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Documentos baixados</p>
                <p className="text-xl font-bold text-foreground">{(c?.totalDocBaixados ?? 0).toLocaleString('pt-BR')}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Total de consultas</p>
                <p className="text-xl font-bold text-foreground">{(c?.totalLotes ?? 0).toLocaleString('pt-BR')}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">NSU atual</p>
                <p className="font-mono font-medium text-foreground">{c ? nsuInt(c.ultimoNsu).toLocaleString('pt-BR') : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">NSU máximo</p>
                <p className="font-mono font-medium text-foreground">{c ? nsuInt(c.maxNsu).toLocaleString('pt-BR') : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Última consulta</p>
                <p className="font-medium text-foreground">{fmtDateTime(c?.ultimaConsulta)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Próxima consulta</p>
                <p className="font-medium text-foreground">
                  {fmtDateTime(c?.proximaConsulta) !== '—' ? fmtDateTime(c?.proximaConsulta) : `às ${config.horarioCaptura}`}
                </p>
              </div>
            </div>
            {pendentes > 0 ? (
              <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
                {pendentes.toLocaleString('pt-BR')} NSU(s) pendente(s) de download
              </div>
            ) : c ? (
              <div className="mt-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 flex items-center gap-1.5">
                <CheckCircleIcon size={12} />NSU atualizado
              </div>
            ) : null}
            {temErro && c?.ultimoErro ? (
              <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 space-y-1">
                <p className="text-xs font-semibold text-red-700">Último erro ({c.errosConsecutivos} consecutivo{c.errosConsecutivos !== 1 ? 's' : ''})</p>
                <p className="text-xs text-red-600">{c.ultimoErro}</p>
                <p className="text-xs text-red-400">{fmtDateTime(c.ultimoErroEm)}</p>
              </div>
            ) : null}
          </div>

          {/* Seção: Varredura retroativa */}
          {varredura !== null && (
            <div className="px-6 py-5 border-b border-border/60">
              <div className="flex items-center gap-2 mb-4">
                <FileMagnifyingGlassIcon size={14} className="text-primary" weight="fill" />
                <span className="text-[11px] font-bold text-primary uppercase tracking-widest">Varredura retroativa</span>
                {varredura === 'loading' ? null : (
                  <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                    varredura.status === 'ATIVA' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                    varredura.status === 'CONCLUIDA' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                    varredura.status === 'ERRO' ? 'bg-red-50 text-red-700 border-red-200' :
                    'bg-muted text-muted-foreground border-border'
                  }`}>
                    {varredura.status === 'ATIVA' && <ArrowsClockwiseIcon size={9} className="animate-spin" />}
                    {varredura.status === 'ATIVA' ? 'Em andamento' :
                     varredura.status === 'CONCLUIDA' ? 'Concluída' :
                     varredura.status === 'PAUSADA' ? 'Pausada' : 'Erro'}
                  </span>
                )}
              </div>
              {varredura === 'loading' ? (
                <div className="h-20 bg-muted rounded-lg animate-pulse" />
              ) : (
                <>
                  {/* Barra de progresso */}
                  <div className="mb-3">
                    <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                      <span>NSU {nsuInt(varredura.nsuInicio).toLocaleString('pt-BR')} → {nsuInt(varredura.nsuFim).toLocaleString('pt-BR')}</span>
                      <span className="font-semibold text-foreground">{(varredura.percentual ?? 0).toFixed(1)}%</span>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          varredura.status === 'CONCLUIDA' ? 'bg-emerald-500' :
                          varredura.status === 'ERRO' ? 'bg-red-400' :
                          varredura.status === 'PAUSADA' ? 'bg-amber-400' : 'bg-primary'
                        }`}
                        style={{ width: `${Math.min(100, varredura.percentual ?? 0)}%` }}
                      />
                    </div>
                  </div>
                  {/* Métricas */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">NSU atual</p>
                      <p className="font-mono font-medium text-foreground">{nsuInt(varredura.nsuAtual).toLocaleString('pt-BR')}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Documentos recuperados</p>
                      <p className="font-mono font-medium text-foreground">{(varredura.totalRecuperado ?? 0).toLocaleString('pt-BR')}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">NSUs consultados</p>
                      <p className="font-mono font-medium text-foreground">{(varredura.totalConsultado ?? 0).toLocaleString('pt-BR')}</p>
                    </div>
                    {varredura.status === 'ATIVA' && varredura.estimativaConclusao ? (
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">Estimativa conclusão</p>
                        <p className="text-xs font-medium text-foreground">{fmtDateTime(varredura.estimativaConclusao)}</p>
                      </div>
                    ) : varredura.concluidoEm ? (
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">Concluída em</p>
                        <p className="text-xs font-medium text-foreground">{fmtDateTime(varredura.concluidoEm)}</p>
                      </div>
                    ) : null}
                  </div>
                  {varredura.ultimoErro ? (
                    <div className="mt-3 p-2.5 rounded-lg bg-red-50 border border-red-200">
                      <p className="text-xs text-red-600">{varredura.ultimoErro}</p>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}

          {/* Seção: Histórico SEFAZ */}
          <div className="px-6 py-5">
            <div className="flex items-center gap-2 mb-4">
              <ClockCounterClockwiseIcon size={14} className="text-primary" weight="fill" />
              <span className="text-[11px] font-bold text-primary uppercase tracking-widest">Histórico SEFAZ</span>
            </div>

            {loadingLotes && lotes.length === 0 ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
                ))}
              </div>
            ) : lotes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                <ClockCounterClockwiseIcon size={28} className="opacity-30" />
                <p className="text-sm">Nenhum lote registrado</p>
              </div>
            ) : (
              <div className="space-y-0 rounded-lg border border-border overflow-hidden">
                {lotes.map((lote) => {
                  const badge = cstatBadge(lote.cStat);
                  const accentMap: Record<string, string> = {
                    ok: 'border-l-emerald-400', info: 'border-l-slate-300',
                    warn: 'border-l-amber-400', err: 'border-l-red-400',
                  };
                  const nsuEnv = nsuInt(lote.nsuEnviado);
                  const nsuRec = nsuInt(lote.ultNsuRecebido);
                  const showRange = nsuRec > 0 && nsuRec !== nsuEnv;
                  const duracaoSeg = lote.duracaoMs ? (lote.duracaoMs / 1000).toFixed(2) : null;
                  return (
                    <div key={lote.id} className={`pl-3 pr-4 py-3 border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors border-l-2 ${accentMap[badge.tipo] ?? 'border-l-amber-400'}`}>
                      {/* Data/hora envio + docs */}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {fmtDateTimeSec(lote.iniciadoEm)}
                          {duracaoSeg ? <span className="ml-1 text-muted-foreground/50">({duracaoSeg}s)</span> : null}
                        </span>
                        {lote.qtdDocumentos > 0 ? (
                          <span className="text-xs bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">
                            {lote.qtdDocumentos} doc{lote.qtdDocumentos !== 1 ? 's' : ''}
                          </span>
                        ) : null}
                      </div>
                      {/* cStat + descrição */}
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded ${badge.cls}`}>
                          {badge.label}
                        </span>
                        <span className="text-xs text-foreground/80 font-medium">{badge.descricao}</span>
                      </div>
                      {/* xMotivo literal */}
                      {lote.xMotivo && lote.xMotivo !== badge.descricao ? (
                        <p className="text-xs text-muted-foreground mt-1 leading-snug italic">&ldquo;{lote.xMotivo}&rdquo;</p>
                      ) : null}
                      {/* NSU */}
                      <div className="mt-1 text-[10px] text-muted-foreground/60 font-mono">
                        NSU {nsuEnv.toLocaleString('pt-BR')}{showRange ? ` → ${nsuRec.toLocaleString('pt-BR')}` : ''}
                        {lote.erroMensagem ? <span className="text-red-400 font-sans ml-2">{lote.erroMensagem}</span> : null}
                      </div>
                    </div>
                  );
                })}
                {hasMore ? (
                  <div className="p-3 text-center border-t border-border/40">
                    <button type="button" onClick={() => { void carregarLotes(lotePage + 1); }} disabled={loadingLotes}
                      className="text-xs text-primary hover:underline disabled:opacity-50">
                      {loadingLotes ? 'Carregando…' : 'Carregar mais'}
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {/* ── Footer com ações ── */}
        <div className="px-6 py-4 border-t border-border bg-muted/30 flex flex-col gap-2 shrink-0">
          {/* Linha principal de ações */}
          <div className="flex items-center gap-2">
            <button type="button"
              disabled={downloadingId === config.id || !config.ativo}
              onClick={() => { onDownload(config.id); }}
              className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 rounded-lg bg-sky-50 text-sky-700 border border-sky-200 text-sm font-medium hover:bg-sky-100 disabled:opacity-40 transition-colors">
              <CloudArrowDownIcon size={14} className={downloadingId === config.id ? 'animate-pulse' : ''} />
              Baixar NF-e
            </button>
            <button type="button"
              disabled={syncingId === config.id || !config.ativo}
              onClick={() => { onSync(config.id); }}
              className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted disabled:opacity-40 transition-colors">
              <ArrowsClockwiseIcon size={14} className={syncingId === config.id ? 'animate-spin' : ''} />
              Sincronizar
            </button>
            <div className="flex-1" />
            <button type="button"
              onClick={() => { onToggle(config.id); }}
              className={[
                'inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 rounded-lg text-sm font-medium transition-colors border',
                config.ativo
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-muted text-muted-foreground border-input hover:bg-muted/80',
              ].join(' ')}>
              {config.ativo ? <ToggleRightIcon size={16} weight="fill" /> : <ToggleLeftIcon size={16} />}
              {config.ativo ? 'Ativo' : 'Inativo'}
            </button>
            <button type="button" onClick={onClose}
              className="inline-flex items-center whitespace-nowrap px-3 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors">
              Fechar
            </button>
          </div>
          {/* Linha de exclusão */}
          {!confirmarExcluir ? (
            <button type="button"
              onClick={() => { setConfirmarExcluir(true); }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 text-red-600 bg-red-50 text-sm font-medium hover:bg-red-100 transition-colors w-full justify-center">
              <TrashIcon size={14} />
              Excluir configuração
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <WarningIcon size={14} className="text-red-600 shrink-0" />
              <span className="text-xs text-red-700 flex-1">Excluir também apaga todos os documentos capturados. Confirmar?</span>
              <button type="button"
                onClick={() => { setConfirmarExcluir(false); }}
                disabled={excluindo}
                className="px-2 py-1 rounded text-xs border border-input bg-background text-foreground hover:bg-muted transition-colors disabled:opacity-50">
                Cancelar
              </button>
              <button type="button"
                disabled={excluindo}
                onClick={async () => {
                  setExcluindo(true);
                  try { await onDelete(config.id); }
                  finally { setExcluindo(false); setConfirmarExcluir(false); }
                }}
                className="px-2 py-1 rounded text-xs bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50">
                {excluindo ? 'Excluindo…' : 'Excluir'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Modal de nova configuração                                          */
/* ─────────────────────────────────────────────────────────────────── */

function NovaConfigModal({ empresas, certificados, onClose, onSave, saving }: Readonly<{
  empresas: Empresa[]; certificados: Certificado[];
  onClose: () => void; onSave: (form: FormState) => void; saving: boolean;
}>) {
  const primeiraEmpresa = empresas[0];
  const certDaPrimeiraEmpresa = certificados.find((c) => c.cnpj === primeiraEmpresa?.cnpj);
  const [form, setForm] = useState<FormState>({
    cnpj: primeiraEmpresa?.cnpj ?? '', tpAmb: 2,
    certificadoId: certDaPrimeiraEmpresa?.id ?? certificados[0]?.id ?? '',
    horarioCaptura: '08:00', intervaloMinutos: 60,
  });
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(false);
  const comboRef = React.useRef<HTMLDivElement>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));
  const empresaSelecionada = empresas.find((e) => e.cnpj === form.cnpj);
  const certAssociado = certificados.find((c) => c.cnpj === form.cnpj);

  const empresasFiltradas = empresas.filter((e) => {
    const q = busca.toLowerCase();
    return (
      e.cnpj.includes(q) ||
      (e.nomeFantasia || e.nome).toLowerCase().includes(q)
    );
  });

  const selecionarEmpresa = (emp: Empresa) => {
    set('cnpj', emp.cnpj);
    const cert = certificados.find((c) => c.cnpj === emp.cnpj);
    if (cert) set('certificadoId', cert.id);
    setBusca('');
    setAberto(false);
  };

  // fecha ao clicar fora
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setAberto(false);
        setBusca('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <Modal isOpen onClose={onClose} title="Nova Configuração DFe" size="2xl">
      <div className="space-y-4">
        {form.tpAmb === 2 ? (
          <div className="flex gap-2 rounded-lg bg-sky-50 border border-sky-200 px-3 py-2.5 text-xs text-sky-700">
            <InfoIcon size={14} className="shrink-0 mt-0.5" />
            <span>Ambiente de <strong>homologação</strong> — use para testes.</span>
          </div>
        ) : null}

        {/* Empresa — combobox pesquisável */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            Empresa (CNPJ monitorado) <span className="text-destructive">*</span>
          </label>
          {empresas.length === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground text-center">
              Nenhuma empresa cadastrada. <a href="/empresas" className="text-primary underline">Cadastre uma empresa</a> primeiro.
            </div>
          ) : (
            <div ref={comboRef} className="relative">
              <button
                type="button"
                onClick={() => { setAberto((v) => !v); if (!aberto) setBusca(''); }}
                className="w-full flex items-center justify-between rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring text-left"
              >
                {empresaSelecionada ? (
                  <span>
                    <span className="font-mono">{maskCnpj(empresaSelecionada.cnpj)}</span>
                    <span className="text-muted-foreground"> — {empresaSelecionada.nomeFantasia || empresaSelecionada.nome}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Selecione uma empresa…</span>
                )}
                <CaretDownIcon size={14} className={`text-muted-foreground transition-transform shrink-0 ${aberto ? 'rotate-180' : ''}`} />
              </button>

              {aberto && (
                <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-background shadow-lg">
                  <div className="p-2 border-b border-border">
                    <input
                      autoFocus
                      type="text"
                      placeholder="Pesquisar por CNPJ ou nome…"
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      className="w-full rounded-md border border-input bg-muted/30 px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <ul className="max-h-52 overflow-y-auto py-1">
                    {empresasFiltradas.length === 0 ? (
                      <li className="px-3 py-2 text-xs text-muted-foreground">Nenhuma empresa encontrada.</li>
                    ) : empresasFiltradas.map((e) => (
                      <li key={e.cnpj}>
                        <button
                          type="button"
                          onClick={() => selecionarEmpresa(e)}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/60 transition-colors flex items-center gap-2 ${form.cnpj === e.cnpj ? 'bg-primary/5 font-medium' : ''}`}
                        >
                          <span className="font-mono text-xs text-muted-foreground shrink-0">{maskCnpj(e.cnpj)}</span>
                          <span className="truncate">{e.nomeFantasia || e.nome}</span>
                          {e.uf ? <span className="ml-auto text-xs text-muted-foreground shrink-0">({e.uf})</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {empresaSelecionada && !empresaSelecionada.uf ? (
            <p className="text-xs text-destructive mt-1.5 flex items-center gap-1">
              <WarningIcon size={11} />Esta empresa não tem UF cadastrada. <a href="/empresas" className="underline">Atualize</a>.
            </p>
          ) : null}
        </div>

        {/* Certificado — fixo ao da empresa, ou selecionável se não houver */}
        <div>
          <label htmlFor="dfe-cert" className="block text-xs font-medium text-muted-foreground mb-1.5">
            Certificado A1 <span className="text-destructive">*</span>
          </label>
          {certificados.length === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground text-center">
              Nenhum certificado ativo. <a href="/certificados" className="text-primary underline">Importe um certificado</a> primeiro.
            </div>
          ) : certAssociado ? (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm flex items-center gap-2">
              <SealCheckIcon size={14} className="text-emerald-500 shrink-0" />
              <span>
                <span className="font-mono text-xs text-muted-foreground">{maskCnpj(certAssociado.cnpj)}</span>
                {' — '}{certAssociado.razaoSocial}
                <span className="text-xs text-muted-foreground ml-1">(vence {fmtDate(certAssociado.validade)})</span>
              </span>
            </div>
          ) : (
            <>
              <select id="dfe-cert" title="Certificado A1" value={form.certificadoId}
                onChange={(e) => { set('certificadoId', e.target.value); }}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
                {certificados.map((c) => (
                  <option key={c.id} value={c.id}>
                    {maskCnpj(c.cnpj)} — {c.razaoSocial} (vence {fmtDate(c.validade)})
                  </option>
                ))}
              </select>
              <p className="text-xs text-amber-600 mt-1.5 flex items-center gap-1">
                <WarningIcon size={11} />Nenhum certificado encontrado para este CNPJ. Selecione manualmente.
              </p>
            </>
          )}
        </div>

        <div>
          <label htmlFor="dfe-amb" className="block text-xs font-medium text-muted-foreground mb-1.5">
            Ambiente <span className="text-destructive">*</span>
          </label>
          <select id="dfe-amb" title="Ambiente" value={form.tpAmb}
            onChange={(e) => { set('tpAmb', Number(e.target.value) as 1 | 2); }}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
            <option value={2}>Homologação (testes)</option>
            <option value={1}>Produção</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="dfe-horario" className="block text-xs font-medium text-muted-foreground mb-1.5">
              Horário de início <span className="text-destructive">*</span>
            </label>
            <input id="dfe-horario" type="time" value={form.horarioCaptura}
              onChange={(e) => { set('horarioCaptura', e.target.value); }}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label htmlFor="dfe-intervalo" className="block text-xs font-medium text-muted-foreground mb-1.5">
              Periodicidade <span className="text-destructive">*</span>
            </label>
            <select id="dfe-intervalo" title="Periodicidade" value={form.intervaloMinutos}
              onChange={(e) => { set('intervaloMinutos', Number(e.target.value)); }}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
              {INTERVALO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t border-border mt-4">
        <button type="button" onClick={onClose}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors">
          <XIcon size={14} /> Cancelar
        </button>
        <button type="button"
          disabled={saving || !form.cnpj || !form.certificadoId || !empresaSelecionada?.uf}
          onClick={() => { onSave(form); }}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
          <CloudArrowDownIcon size={15} />
          {saving ? 'Salvando…' : 'Ativar Monitoramento'}
        </button>
      </div>
    </Modal>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Page                                                                */
/* ─────────────────────────────────────────────────────────────────── */

type FiltroStatus = 'todos' | 'ativos' | 'inativos';

export default function DfePage() {
  const [configs, setConfigs] = useState<DfeConfig[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [certificados, setCertificados] = useState<Certificado[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('todos');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { toasts, success, error: toastError, dismiss } = useToast();

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, empRes, certRes] = await Promise.all([
        api.get('/dfe/status'),
        api.get('/empresas?limit=100'),
        api.get('/certificados'),
      ]);
      setConfigs(statusRes.data as DfeConfig[]);
      const emps = (empRes.data?.data ?? empRes.data ?? []) as Empresa[];
      setEmpresas(emps.filter((e) => e.cnpj));
      const certs = (certRes.data?.data ?? certRes.data ?? []) as Record<string, unknown>[];
      setCertificados(
        certs
          .filter((c) => c.status === 'ATIVO' || c.status === 'EXPIRACAO_PROXIMA')
          .map((c) => ({
            id: c.id as string,
            cnpj: (c.cnpjCert ?? c.cnpj ?? '') as string,
            razaoSocial: (c.razaoSocial ?? '') as string,
            validade: (c.dataValidade ?? c.validade ?? '') as string,
            status: c.status as string,
          })),
      );
    } catch {
      toastError('Erro ao carregar configurações DFe');
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => { void carregar(); }, [carregar]);

  const handleToggle = useCallback(async (configId: string) => {
    try {
      const res = await api.post(`/dfe/${configId}/toggle`);
      const updated = res.data as { id: string; ativo: boolean };
      setConfigs((prev) => prev.map((c) => c.id === configId ? { ...c, ativo: updated.ativo } : c));
      success(updated.ativo ? 'Monitoramento ativado' : 'Monitoramento desativado');
    } catch { toastError('Erro ao alterar status'); }
  }, [success, toastError]);

  const handleSync = useCallback(async (configId: string) => {
    setSyncingId(configId);
    try {
      await api.post(`/dfe/sincronizar/${configId}`);
      success('Sincronização iniciada');
      setTimeout(() => { void carregar(); }, 3000);
    } catch { toastError('Erro ao iniciar sincronização'); }
    finally { setSyncingId(null); }
  }, [carregar, success, toastError]);

  const handleDelete = useCallback(async (configId: string) => {
    try {
      await api.delete(`/dfe/${configId}`);
      success('Configuração DFe excluída com sucesso');
      setSelectedId(null);
      setConfigs((prev) => prev.filter((c) => c.id !== configId));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toastError(msg ?? 'Erro ao excluir configuração DFe');
      throw err;
    }
  }, [success, toastError]);

  const handleDownload = useCallback(async (configId: string) => {
    setDownloadingId(configId);
    try {
      await api.post(`/dfe/${configId}/baixar`);
      success('Download de NF-e iniciado');
      setTimeout(() => { void carregar(); }, 5000);
    } catch { toastError('Erro ao iniciar download'); }
    finally { setDownloadingId(null); }
  }, [carregar, success, toastError]);

  const handleSave = useCallback(async (form: FormState) => {
    setSaving(true);
    try {
      await api.post('/dfe/configurar', {
        cnpj: form.cnpj.replace(/[.\-\/\s]/g, '').toUpperCase(),
        tpAmb: Number(form.tpAmb) as 1 | 2,
        certificadoId: form.certificadoId,
        horarioCaptura: form.horarioCaptura,
        intervaloMinutos: Number(form.intervaloMinutos),
      });
      setShowModal(false);
      success('Monitoramento DFe configurado com sucesso');
      await carregar();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toastError(msg ?? 'Erro ao salvar configuração');
    } finally { setSaving(false); }
  }, [carregar, success, toastError]);

  const configsFiltradas = configs.filter((c) => {
    const q = busca.toLowerCase();
    const cnpjMatch = busca.trim() === '' ||
      c.cnpj.replace(/\D/g, '').includes(busca.replace(/\D/g, '')) ||
      maskCnpj(c.cnpj).toLowerCase().includes(q) ||
      (c.nomeFantasia || c.nome || '').toLowerCase().includes(q);
    const statusMatch = filtroStatus === 'todos' || (filtroStatus === 'ativos' ? c.ativo : !c.ativo);
    return cnpjMatch && statusMatch;
  });

  const selectedConfig = configs.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0 h-full overflow-y-auto pb-4">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">DF-e / NF-e de Interesse</h1>
          <p className="text-sm text-muted-foreground mt-1">Clique em uma linha para ver detalhes e histórico</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dfe/documentos"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors">
            <FileMagnifyingGlassIcon size={16} />Ver documentos
          </Link>
          <button type="button" onClick={() => { void carregar(); }} disabled={loading} title="Atualizar"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50">
            <ArrowClockwiseIcon size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button type="button" onClick={() => { setShowModal(true); }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            <PlusIcon size={16} />Nova Configuração
          </button>
        </div>
      </div>

      {/* Card principal */}
      <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden flex-1 min-h-0 flex flex-col">
        {/* Card header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <p className="font-semibold text-foreground">Configurações DFe</p>
            <p className="text-xs text-muted-foreground">{configs.length} configuração{configs.length !== 1 ? 'ões' : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Busca */}
            <div className="relative">
              <MagnifyingGlassIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                className="pl-8 pr-3 py-2 text-sm border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary w-44 bg-background"
                placeholder="Buscar por CNPJ…"
                value={busca}
                onChange={(e) => { setBusca(e.target.value); }}
              />
            </div>
            {/* Filtro status */}
            <div className="flex items-center gap-1">
              {(['todos', 'ativos', 'inativos'] as const).map((op) => (
                <button key={op} type="button" onClick={() => { setFiltroStatus(op); }}
                  className={[
                    'px-3 py-1.5 rounded-lg text-sm capitalize transition-colors border',
                    filtroStatus === op
                      ? 'bg-primary text-primary-foreground border-primary font-medium'
                      : 'bg-background text-muted-foreground border-input hover:bg-muted',
                  ].join(' ')}>
                  {op}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Tabela */}
        <div className="flex-1 min-h-0 overflow-auto">
          <DataTable<DfeConfig>
            columns={[
              {
                key: 'cnpj', header: 'Empresa',
                render: (row) => (
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      {row.ativo
                        ? <WifiHighIcon size={13} className="text-primary" weight="fill" />
                        : <WifiSlashIcon size={13} className="text-muted-foreground" weight="fill" />}
                    </div>
                    <div className="flex flex-col leading-tight">
                      {(row.nomeFantasia || row.nome) && (
                        <span className="text-sm font-medium text-foreground truncate max-w-52">
                          {row.nomeFantasia || row.nome}
                        </span>
                      )}
                      <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">{maskCnpj(row.cnpj)}</span>
                    </div>
                  </div>
                ),
              },
              {
                key: 'tpAmb', header: 'Ambiente',
                render: (row) => (
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${row.tpAmb === 1 ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'}`}>
                    {row.tpAmb === 1 ? 'Produção' : 'Homologação'}
                  </span>
                ),
              },
              {
                key: 'certificado', header: 'Certificado',
                render: (row) => row.certificado ? (
                  <span className="text-xs font-medium text-foreground flex items-center gap-1">
                    <SealCheckIcon size={11} className="text-emerald-500 shrink-0" />
                    {razaoSocialSemCnpj(row.certificado.razaoSocial)}
                  </span>
                ) : <span className="text-xs text-muted-foreground">—</span>,
              },
              {
                key: 'vencimento', header: 'Vencimento',
                render: (row) => {
                  if (!row.certificado?.dataValidade) return <span className="text-xs text-muted-foreground">—</span>;
                  const venc = new Date(row.certificado.dataValidade);
                  const dias = Math.ceil((venc.getTime() - Date.now()) / 86_400_000);
                  const cls = dias <= 0 ? 'text-red-600 font-semibold' : dias <= 30 ? 'text-amber-600 font-medium' : 'text-muted-foreground';
                  return <span className={`text-xs whitespace-nowrap ${cls}`}>{fmtDate(row.certificado.dataValidade)}</span>;
                },
              },
              {
                key: 'documentos', header: 'Documentos',
                render: (row) => (
                  <span className="font-semibold text-foreground">
                    {(row.controle?.totalDocBaixados ?? 0).toLocaleString('pt-BR')}
                  </span>
                ),
              },
              {
                key: 'nsu', header: 'Varredura NSU',
                render: (row) => {
                  const pendentes = pendentesNsu(row.controle);
                  if (!row.controle) return <span className="text-xs text-muted-foreground">—</span>;
                  return pendentes > 0 ? (
                    <span className="text-xs font-mono text-amber-600 font-medium">
                      {nsuInt(row.controle.ultimoNsu).toLocaleString('pt-BR')}
                      <span className="text-muted-foreground font-normal"> / {nsuInt(row.controle.maxNsu).toLocaleString('pt-BR')}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                      <CheckCircleIcon size={12} />Atualizado
                    </span>
                  );
                },
              },
              {
                key: 'ultimaConsulta', header: 'Última consulta',
                render: (row) => (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                    <ClockIcon size={11} />{fmtDateTime(row.controle?.ultimaConsulta)}
                  </div>
                ),
              },
              {
                key: 'retorno', header: 'Retorno',
                render: (row) => {
                  if (!row.controle?.ultimoLote) return <span className="text-xs text-muted-foreground">—</span>;
                  const badge = cstatBadge(row.controle.ultimoLote.cStat);
                  return (
                    <span className={`inline-flex items-center text-xs font-mono font-semibold px-1.5 py-0.5 rounded ${badge.cls}`}>
                      {badge.label}
                    </span>
                  );
                },
              },
              {
                key: 'retornoDesc', header: 'Descrição retorno',
                render: (row) => {
                  if (!row.controle?.ultimoLote) return <span className="text-xs text-muted-foreground">—</span>;
                  const badge = cstatBadge(row.controle.ultimoLote.cStat);
                  return <span className="text-xs text-muted-foreground">{badge.descricao}</span>;
                },
              },
              {
                key: 'status', header: 'Status',
                render: (row) => {
                  if (!row.ativo) return (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />Inativo
                    </span>
                  );
                  if (row.controle?.emProcessamento) return (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
                      <ArrowsClockwiseIcon size={10} className="animate-spin" />Processando
                    </span>
                  );
                  if ((row.controle?.errosConsecutivos ?? 0) >= 3) return (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">
                      <WarningIcon size={10} />Erro
                    </span>
                  );
                  return (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Ativo
                    </span>
                  );
                },
              },
            ]}
            data={configsFiltradas}
            isLoading={loading}
            keyExtractor={(row) => row.id}
            emptyMessage={busca || filtroStatus !== 'todos' ? 'Nenhuma configuração encontrada.' : 'Nenhuma configuração DFe. Clique em "Nova Configuração" para começar.'}
            onRowClick={(row) => { setSelectedId(selectedId === row.id ? null : row.id); }}
            rowClassName={(row) => selectedId === row.id ? 'bg-primary/5' : ''}
          />
        </div>
      </div>

      {/* Drawer de detalhe */}
      {selectedConfig ? (
        <ConfigDrawer
          config={selectedConfig}
          onClose={() => { setSelectedId(null); }}
          onToggle={(id) => { void handleToggle(id); }}
          onSync={(id) => { void handleSync(id); }}
          onDownload={(id) => { void handleDownload(id); }}
          onDelete={handleDelete}
          syncingId={syncingId}
          downloadingId={downloadingId}
        />
      ) : null}

      {/* Modal nova configuração */}
      {showModal ? (
        <NovaConfigModal
          empresas={empresas} certificados={certificados}
          onClose={() => { setShowModal(false); }}
          onSave={(form) => { void handleSave(form); }}
          saving={saving}
        />
      ) : null}
    </div>
  );
}
