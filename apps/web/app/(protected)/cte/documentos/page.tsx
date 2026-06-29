'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowClockwiseIcon,
  MagnifyingGlassIcon,
  GearIcon,
  XIcon,
  TruckIcon,
  WarningIcon,
  ClockCounterClockwiseIcon,
  ProhibitIcon,
  CaretLeftIcon,
  CaretRightIcon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/api';
import { useToast, ToastContainer } from '@/components/ui/toast';
import { useEmpresaSelecionada } from '@/lib/empresa-selecionada';

/* ─────────────────────────────────────────────────────────────────── */
/* Types                                                               */
/* ─────────────────────────────────────────────────────────────────── */

interface CteConfigLite {
  id: string;
  cnpj: string;
  nome: string | null;
  nomeFantasia: string | null;
}

interface CteDocumento {
  id: string;
  nsu: string;
  tipoDocumento: 'PROC_CTE' | 'PROC_EVENTO_CTE' | 'RES_CTE' | 'RES_EVENTO_CTE';
  modelo: number | null;
  chaveAcesso: string | null;
  cteEmitenteCnpj: string | null;
  cteEmitenteNome: string | null;
  cteValorPrestacao: string | number | null;
  cteDhEmissao: string | null;
  cteSituacao: string | null;
  tpCte: number | null;
  modal: string | null;
  ufIni: string | null;
  ufFim: string | null;
  cteTomadorCnpj: string | null;
  cteRemetenteCnpj: string | null;
  cteDestinatarioCnpj: string | null;
  cteChavesNfe: string | null;
  eventoTipo: string | null;
  eventoDescricao: string | null;
  criadoEm: string;
}

interface CteEvento {
  id: string;
  tpEvento: string;
  xEvento: string;
  nSeqEvento: number;
  xObs: string | null;
  status: 'PENDENTE' | 'ENVIADO' | 'REJEITADO' | 'ERRO';
  nProt: string | null;
  cStat: string | null;
  xMotivo: string | null;
  dhRegEvento: string | null;
  erroMensagem: string | null;
  criadoEm: string;
}

interface PageMeta { page: number; limit: number; total: number; totalPages: number; }

type Papel = 'todos' | 'tomador';

/* ─────────────────────────────────────────────────────────────────── */
/* Helpers                                                             */
/* ─────────────────────────────────────────────────────────────────── */

function maskCnpj(v: string | null | undefined) {
  const raw = (v ?? '').replace(/[.\-/\s]/g, '').slice(0, 14);
  if (/^\d{14}$/.test(raw))
    return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8, 12)}-${raw.slice(12)}`;
  return raw || '—';
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

function fmtMoney(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : Number.parseFloat(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const MODELO_LABEL: Record<number, string> = { 57: 'CT-e', 67: 'CT-e OS', 64: 'GTV-e' };

function tipoBadge(tipo: CteDocumento['tipoDocumento']): { label: string; cls: string } {
  switch (tipo) {
    case 'PROC_CTE': return { label: 'CT-e', cls: 'bg-sky-50 text-sky-700' };
    case 'PROC_EVENTO_CTE': return { label: 'Evento', cls: 'bg-violet-50 text-violet-700' };
    case 'RES_CTE': return { label: 'Resumo', cls: 'bg-slate-100 text-slate-600' };
    case 'RES_EVENTO_CTE': return { label: 'Resumo evt.', cls: 'bg-slate-100 text-slate-600' };
    default: return { label: tipo, cls: 'bg-slate-100 text-slate-600' };
  }
}

function situacaoBadge(cStat: string | null): { label: string; cls: string } | null {
  if (!cStat) return null;
  if (cStat === '100') return { label: 'Autorizado', cls: 'bg-emerald-50 text-emerald-700' };
  if (cStat === '101' || cStat === '135') return { label: 'Cancelado', cls: 'bg-red-50 text-red-700' };
  if (cStat === '110' || cStat === '301' || cStat === '302') return { label: 'Denegado', cls: 'bg-red-50 text-red-700' };
  return { label: cStat, cls: 'bg-amber-50 text-amber-700' };
}

const EVENTO_STATUS: Record<CteEvento['status'], { label: string; cls: string }> = {
  PENDENTE: { label: 'Pendente', cls: 'bg-amber-50 text-amber-700' },
  ENVIADO: { label: 'Enviado', cls: 'bg-emerald-50 text-emerald-700' },
  REJEITADO: { label: 'Rejeitado', cls: 'bg-red-50 text-red-700' },
  ERRO: { label: 'Erro', cls: 'bg-red-50 text-red-700' },
};

/* ─────────────────────────────────────────────────────────────────── */
/* Modal: registrar desacordo                                          */
/* ─────────────────────────────────────────────────────────────────── */

function DesacordoModal({ doc, onClose, onConfirm, enviando }: Readonly<{
  doc: CteDocumento;
  onClose: () => void;
  onConfirm: (xObs: string) => void;
  enviando: boolean;
}>) {
  const [xObs, setXObs] = useState('');
  const len = xObs.trim().length;
  const valido = len >= 15 && len <= 255;

  return (
    <Modal isOpen onClose={onClose} title="Prestação de Serviço em Desacordo" size="lg">
      <div className="space-y-4">
        <div className="flex gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-700">
          <WarningIcon size={14} className="shrink-0 mt-0.5" />
          <span>
            O evento <strong>610110</strong> só pode ser registrado pelo <strong>tomador</strong> do serviço e é
            irreversível pela SEFAZ (cancelável por outro evento). Prazo: 45 dias da autorização.
          </span>
        </div>

        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-sm space-y-1">
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground text-xs">Transportadora</span>
            <span className="font-medium text-right truncate">{doc.cteEmitenteNome || maskCnpj(doc.cteEmitenteCnpj)}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground text-xs">Chave</span>
            <span className="font-mono text-xs text-right">{doc.chaveAcesso}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground text-xs">Valor da prestação</span>
            <span className="font-medium">{fmtMoney(doc.cteValorPrestacao)}</span>
          </div>
        </div>

        <div>
          <label htmlFor="cte-xobs" className="block text-xs font-medium text-muted-foreground mb-1.5">
            Justificativa do desacordo <span className="text-destructive">*</span>
          </label>
          <textarea
            id="cte-xobs"
            rows={4}
            value={xObs}
            onChange={(e) => setXObs(e.target.value)}
            placeholder="Descreva o motivo do desacordo (mínimo 15 caracteres)…"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-none"
          />
          <div className="flex justify-between mt-1">
            <span className={`text-xs ${len > 0 && len < 15 ? 'text-destructive' : 'text-muted-foreground'}`}>
              {len < 15 ? `Faltam ${15 - len} caractere(s)` : 'OK'}
            </span>
            <span className={`text-xs ${len > 255 ? 'text-destructive' : 'text-muted-foreground'}`}>{len}/255</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t border-border mt-4">
        <button type="button" onClick={onClose}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors">
          <XIcon size={14} /> Cancelar
        </button>
        <button type="button"
          disabled={!valido || enviando}
          onClick={() => onConfirm(xObs.trim())}
          className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors">
          <ProhibitIcon size={15} />
          {enviando ? 'Enviando…' : 'Registrar desacordo'}
        </button>
      </div>
    </Modal>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Painel: eventos do documento                                        */
/* ─────────────────────────────────────────────────────────────────── */

function EventosPanel({ doc, onClose }: Readonly<{ doc: CteDocumento; onClose: () => void }>) {
  const [eventos, setEventos] = useState<CteEvento[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ativo = true;
    setLoading(true);
    api.get(`/cte/documentos/${doc.id}/eventos`)
      .then((res) => { if (ativo) setEventos(res.data as CteEvento[]); })
      .catch(() => { if (ativo) setEventos([]); })
      .finally(() => { if (ativo) setLoading(false); });
    return () => { ativo = false; };
  }, [doc.id]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]" onClick={onClose} />
      <div className="fixed top-0 right-0 z-50 h-full w-[460px] max-w-[92vw] bg-card shadow-2xl flex flex-col border-l border-border overflow-hidden">
        <div className="px-6 py-5 border-b border-border shrink-0 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Eventos do CT-e</p>
            <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{doc.chaveAcesso}</p>
          </div>
          <button type="button" title="Fechar" onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0">
            <XIcon size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)}
            </div>
          ) : eventos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
              <ClockCounterClockwiseIcon size={28} className="opacity-30" />
              <p className="text-sm">Nenhum evento registrado</p>
            </div>
          ) : (
            <div className="space-y-3">
              {eventos.map((ev) => {
                const st = EVENTO_STATUS[ev.status];
                return (
                  <div key={ev.id} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">{ev.xEvento}</span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{ev.tpEvento}</span>
                      <span>·</span>
                      <span>seq {ev.nSeqEvento}</span>
                      {ev.nProt ? <><span>·</span><span className="font-mono">prot {ev.nProt}</span></> : null}
                    </div>
                    {ev.xObs ? <p className="text-xs text-foreground/80 italic">&ldquo;{ev.xObs}&rdquo;</p> : null}
                    {ev.cStat || ev.xMotivo ? (
                      <p className="text-xs text-muted-foreground">
                        {ev.cStat ? <span className="font-mono mr-1">{ev.cStat}</span> : null}{ev.xMotivo}
                      </p>
                    ) : null}
                    {ev.erroMensagem ? <p className="text-xs text-red-500">{ev.erroMensagem}</p> : null}
                    <p className="text-[10px] text-muted-foreground/60">
                      {ev.dhRegEvento ? `Registrado ${fmtDateTime(ev.dhRegEvento)}` : `Criado ${fmtDateTime(ev.criadoEm)}`}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Page                                                                */
/* ─────────────────────────────────────────────────────────────────── */

export default function CteDocumentosPage() {
  const [configs, setConfigs] = useState<CteConfigLite[]>([]);
  const [docs, setDocs] = useState<CteDocumento[]>([]);
  const [meta, setMeta] = useState<PageMeta>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const { toasts, success, error: toastError, dismiss } = useToast();
  const { empresa } = useEmpresaSelecionada();

  // Filtros
  const [cnpj, setCnpj] = useState('');
  const [papel, setPapel] = useState<Papel>('todos');
  const [tipo, setTipo] = useState('');
  const [modelo, setModelo] = useState('');
  const [chave, setChave] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [page, setPage] = useState(1);

  // Ações
  const [desacordoDoc, setDesacordoDoc] = useState<CteDocumento | null>(null);
  const [eventosDoc, setEventosDoc] = useState<CteDocumento | null>(null);
  const [enviandoDesacordo, setEnviandoDesacordo] = useState(false);

  // Carrega configs (para o dropdown de empresa) uma vez
  useEffect(() => {
    api.get('/cte/status')
      .then((res) => {
        const cfgs = (res.data as CteConfigLite[]).filter((c) => c.cnpj);
        setConfigs(cfgs);
        // continuidade de empresa selecionada, senão a primeira
        const cnpjAtual = empresa?.cnpj ?? '';
        const inicial = cnpjAtual && cfgs.some((c) => c.cnpj === cnpjAtual)
          ? cnpjAtual
          : cfgs[0]?.cnpj ?? '';
        setCnpj(inicial);
      })
      .catch(() => setConfigs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const carregar = useCallback(async () => {
    if (!cnpj) { setDocs([]); setLoading(false); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      params.set('cnpj', cnpj.replace(/\D/g, ''));
      if (papel === 'tomador') params.set('cteTomadorCnpj', cnpj.replace(/\D/g, ''));
      if (tipo) params.set('tipo', tipo);
      if (modelo) params.set('modelo', modelo);
      if (chave.trim()) params.set('chaveAcesso', chave.replace(/\D/g, ''));
      if (dataInicio) params.set('dataInicio', dataInicio);
      if (dataFim) params.set('dataFim', dataFim);

      const res = await api.get(`/cte/documentos?${params.toString()}`);
      const data = res.data as { data: CteDocumento[]; meta: PageMeta };
      setDocs(data.data);
      setMeta(data.meta);
    } catch {
      toastError('Erro ao carregar documentos CT-e');
    } finally {
      setLoading(false);
    }
  }, [cnpj, papel, tipo, modelo, chave, dataInicio, dataFim, page, toastError]);

  useEffect(() => { void carregar(); }, [carregar]);

  // Reset de página ao mudar filtros
  useEffect(() => { setPage(1); }, [cnpj, papel, tipo, modelo, chave, dataInicio, dataFim]);

  const handleDesacordo = useCallback(async (xObs: string) => {
    if (!desacordoDoc) return;
    setEnviandoDesacordo(true);
    try {
      const res = await api.post(`/cte/documentos/${desacordoDoc.id}/desacordo`, { xObs });
      const ev = res.data as CteEvento;
      if (ev.status === 'ENVIADO') success('Desacordo registrado na SEFAZ');
      else if (ev.status === 'REJEITADO') toastError(`Rejeitado pela SEFAZ: ${ev.xMotivo ?? ev.cStat ?? ''}`);
      else toastError(`Falha ao registrar desacordo: ${ev.erroMensagem ?? 'erro'}`);
      setDesacordoDoc(null);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toastError(msg ?? 'Erro ao registrar desacordo');
    } finally {
      setEnviandoDesacordo(false);
    }
  }, [desacordoDoc, success, toastError]);

  const empresaAtual = useMemo(() => configs.find((c) => c.cnpj === cnpj), [configs, cnpj]);

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0 h-full overflow-y-auto pb-4">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Documentos CT-e</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {empresaAtual ? (empresaAtual.nomeFantasia || empresaAtual.nome || maskCnpj(empresaAtual.cnpj)) : 'Selecione uma empresa monitorada'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/cte"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors">
            <GearIcon size={16} />Configurações
          </Link>
          <button type="button" onClick={() => { void carregar(); }} disabled={loading} title="Atualizar"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50">
            <ArrowClockwiseIcon size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Card principal */}
      <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden flex-1 min-h-0 flex flex-col">
        {/* Filtros */}
        <div className="px-5 py-4 border-b border-border shrink-0 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56">
              <label htmlFor="f-empresa" className="block text-xs font-medium text-muted-foreground mb-1">Empresa</label>
              <select id="f-empresa" title="Empresa" value={cnpj} onChange={(e) => setCnpj(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
                {configs.length === 0 ? <option value="">Nenhuma config CT-e</option> : null}
                {configs.map((c) => (
                  <option key={c.id} value={c.cnpj}>
                    {maskCnpj(c.cnpj)} — {c.nomeFantasia || c.nome || ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-tipo" className="block text-xs font-medium text-muted-foreground mb-1">Tipo</label>
              <select id="f-tipo" title="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
                <option value="">Todos</option>
                <option value="PROC_CTE">CT-e</option>
                <option value="PROC_EVENTO_CTE">Eventos</option>
              </select>
            </div>
            <div>
              <label htmlFor="f-modelo" className="block text-xs font-medium text-muted-foreground mb-1">Modelo</label>
              <select id="f-modelo" title="Modelo" value={modelo} onChange={(e) => setModelo(e.target.value)}
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
                <option value="">Todos</option>
                <option value="57">CT-e (57)</option>
                <option value="67">CT-e OS (67)</option>
                <option value="64">GTV-e (64)</option>
              </select>
            </div>
            <div>
              <label htmlFor="f-dini" className="block text-xs font-medium text-muted-foreground mb-1">De</label>
              <input id="f-dini" type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label htmlFor="f-dfim" className="block text-xs font-medium text-muted-foreground mb-1">Até</label>
              <input id="f-dfim" type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)}
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="flex-1 min-w-48">
              <label htmlFor="f-chave" className="block text-xs font-medium text-muted-foreground mb-1">Chave de acesso</label>
              <div className="relative">
                <MagnifyingGlassIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input id="f-chave" value={chave} onChange={(e) => setChave(e.target.value)} placeholder="44 dígitos…"
                  className="w-full pl-8 pr-3 py-2 text-sm border border-input rounded-lg bg-background outline-none focus:ring-2 focus:ring-ring" />
              </div>
            </div>
          </div>
          {/* Abas por papel */}
          <div className="flex items-center gap-1">
            {([['todos', 'Todos'], ['tomador', 'Como tomador']] as const).map(([op, label]) => (
              <button key={op} type="button" onClick={() => setPapel(op)}
                className={[
                  'px-3 py-1.5 rounded-lg text-sm transition-colors border',
                  papel === op
                    ? 'bg-primary text-primary-foreground border-primary font-medium'
                    : 'bg-background text-muted-foreground border-input hover:bg-muted',
                ].join(' ')}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Tabela */}
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/50 backdrop-blur z-10">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Tipo</th>
                <th className="px-4 py-2.5 font-medium">Situação</th>
                <th className="px-4 py-2.5 font-medium">Transportadora</th>
                <th className="px-4 py-2.5 font-medium">Tomador</th>
                <th className="px-4 py-2.5 font-medium text-right">Valor prest.</th>
                <th className="px-4 py-2.5 font-medium">Emissão</th>
                <th className="px-4 py-2.5 font-medium">Chave</th>
                <th className="px-4 py-2.5 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/40">
                    <td colSpan={8} className="px-4 py-3"><div className="h-5 bg-muted rounded animate-pulse" /></td>
                  </tr>
                ))
              ) : docs.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-16 text-center text-muted-foreground">
                  <TruckIcon size={32} className="mx-auto opacity-30 mb-2" />
                  Nenhum documento CT-e encontrado.
                </td></tr>
              ) : docs.map((doc) => {
                const tb = tipoBadge(doc.tipoDocumento);
                const sb = situacaoBadge(doc.cteSituacao);
                const isCte = doc.tipoDocumento === 'PROC_CTE';
                const isEvento = doc.tipoDocumento === 'PROC_EVENTO_CTE';
                return (
                  <tr key={doc.id} className="border-t border-border/40 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${tb.cls}`}>{tb.label}</span>
                      {doc.modelo ? <span className="ml-1.5 text-[10px] text-muted-foreground">{MODELO_LABEL[doc.modelo] ?? doc.modelo}</span> : null}
                    </td>
                    <td className="px-4 py-2.5">
                      {isEvento ? (
                        <span className="text-xs text-muted-foreground">{doc.eventoDescricao || doc.eventoTipo || '—'}</span>
                      ) : sb ? (
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${sb.cls}`}>{sb.label}</span>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col leading-tight max-w-52">
                        <span className="truncate text-foreground">{doc.cteEmitenteNome || '—'}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">{maskCnpj(doc.cteEmitenteCnpj)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs text-muted-foreground">{maskCnpj(doc.cteTomadorCnpj)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-foreground whitespace-nowrap">{fmtMoney(doc.cteValorPrestacao)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{fmtDate(doc.cteDhEmissao)}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[11px] text-muted-foreground">{doc.chaveAcesso ? `…${doc.chaveAcesso.slice(-12)}` : '—'}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button type="button" onClick={() => setEventosDoc(doc)} title="Ver eventos"
                          className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                          <ClockCounterClockwiseIcon size={15} />
                        </button>
                        {isCte ? (
                          <button type="button" onClick={() => setDesacordoDoc(doc)} title="Registrar desacordo"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors">
                            <ProhibitIcon size={13} />Desacordo
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        <div className="px-5 py-3 border-t border-border shrink-0 flex items-center justify-between text-sm">
          <span className="text-xs text-muted-foreground">
            {meta.total.toLocaleString('pt-BR')} documento{meta.total !== 1 ? 's' : ''}
            {meta.totalPages > 0 ? ` · página ${meta.page} de ${meta.totalPages}` : ''}
          </span>
          <div className="flex items-center gap-1">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded-lg border border-input text-foreground hover:bg-muted disabled:opacity-40 transition-colors">
              <CaretLeftIcon size={15} />
            </button>
            <button type="button" disabled={page >= meta.totalPages || loading} onClick={() => setPage((p) => p + 1)}
              className="p-1.5 rounded-lg border border-input text-foreground hover:bg-muted disabled:opacity-40 transition-colors">
              <CaretRightIcon size={15} />
            </button>
          </div>
        </div>
      </div>

      {desacordoDoc ? (
        <DesacordoModal
          doc={desacordoDoc}
          onClose={() => setDesacordoDoc(null)}
          onConfirm={(xObs) => { void handleDesacordo(xObs); }}
          enviando={enviandoDesacordo}
        />
      ) : null}

      {eventosDoc ? <EventosPanel doc={eventosDoc} onClose={() => setEventosDoc(null)} /> : null}
    </div>
  );
}
