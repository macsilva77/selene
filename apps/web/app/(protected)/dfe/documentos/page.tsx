'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  FunnelIcon,
  FileTextIcon,
  ArrowRightIcon,
  XIcon,
  CheckCircleIcon,
  CaretDownIcon,
  ClockIcon,
  WarningIcon,
  HandWavingIcon,
  CheckSquareIcon,
  SquareIcon,
  DotsThreeVerticalIcon,
  TagIcon,
  ListBulletsIcon,
  FilePdfIcon,
  FileArrowDownIcon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useToast, ToastContainer } from '@/components/ui/toast';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

/* ─────────────────────────────────────────────────────────────────── */
/* Types                                                               */
/* ─────────────────────────────────────────────────────────────────── */

type TipoDocumento = 'PROC_NFE' | 'PROC_EVENTO_NFE' | 'RES_NFE' | 'RES_EVENTO';
type TpEvento = '210200' | '210210' | '210220' | '210240';
type TabId = 'recebidas' | 'emitidas' | 'transportador' | 'citadas';

interface UltimaManifestacao {
  tpEvento: string;
  xEvento: string;
  status: 'PENDENTE' | 'ENVIADO' | 'REJEITADO' | 'ERRO';
  nProt: string | null;
  enviadoEm: string | null;
}

interface ManifestacaoItem {
  id: string;
  tpEvento: string;
  xEvento: string;
  status: 'PENDENTE' | 'ENVIADO' | 'REJEITADO' | 'ERRO';
  nProt: string | null;
  cStat: number | null;
  xMotivo: string | null;
  nSeqEvento: number;
  dhRegEvento: string | null;
  criadoEm: string;
  enviadoEm: string | null;
  tentativas: number;
}

interface Etiqueta {
  id: string;
  nome: string;
  cor: string;
}

interface DfeDocumento {
  id: string;
  nsu: string;
  tipoDocumento: TipoDocumento;
  chaveAcesso: string | null;
  nfeEmitenteCnpj: string | null;
  nfeEmitenteNome: string | null;
  nfeValorTotal: number | null;
  nfeDhEmissao: string | null;
  nfeSituacao: string | null;
  eventoTipo: string | null;
  eventoDescricao: string | null;
  cnpjDestinatario: string | null;
  schema: string | null;
  processado: boolean;
  criadoEm: string;
  ultimaManifestacao: UltimaManifestacao | null;
  etiquetas: Etiqueta[];
}

interface PageMeta { total: number; page: number; limit: number; totalPages: number; }

interface DfeConfigItem { id: string; cnpj: string; nome: string | null; nomeFantasia: string | null; }

interface EtiquetaHistoricoItem {
  id: string;
  criadoEm: string;
  usuario: { id: string; nome: string } | null;
  etiquetasAntes: Etiqueta[];
  etiquetasDepois: Etiqueta[];
}

interface Filters {
  configId: string;
  raizCnpj: boolean;
  cnpj: string;
  cnpjEmitente: string;
  chaveAcesso: string;
  nNF: string;
  valorMin: string;
  valorMax: string;
  dataInicio: string;
  dataFim: string;
  tipo: string;
  etiquetaIds: string[];
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'recebidas', label: 'Recebidas' },
  { id: 'emitidas', label: 'Emitidas' },
  { id: 'transportador', label: 'Transportador' },
  { id: 'citadas', label: 'Citadas' },
];

const EVENTOS: { codigo: TpEvento; label: string; shortLabel: string; exigeJust: boolean }[] = [
  { codigo: '210200', label: 'Confirmação da Operação', shortLabel: 'Confirmação', exigeJust: false },
  { codigo: '210210', label: 'Ciência da Operação', shortLabel: 'Ciência', exigeJust: false },
  { codigo: '210220', label: 'Operação não Realizada', shortLabel: 'Não realizada', exigeJust: true },
  { codigo: '210240', label: 'Desconhecimento da Operação', shortLabel: 'Desconhecimento', exigeJust: false },
];

/* ─────────────────────────────────────────────────────────────────── */
/* Helpers                                                             */
/* ─────────────────────────────────────────────────────────────────── */

function maskCnpj(v: string | null) {
  if (!v) return '—';
  const raw = v.replace(/[.\-/\s]/g, '').slice(0, 14);
  return /^\d{14}$/.test(raw)
    ? `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8, 12)}-${raw.slice(12)}`
    : raw;
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDatetime(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}

function fmtCurrency(val: number | null) {
  if (val === null) return '—';
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Extrai nNF, série e modelo da chave de acesso de 44 dígitos. */
function parseChave(chave: string | null) {
  if (!chave || chave.length !== 44) return { nNF: null, serie: null, modelo: null };
  return {
    modelo: chave.slice(20, 22),
    serie: String(Number(chave.slice(22, 25))),
    nNF: String(Number(chave.slice(25, 34))),
  };
}

/**
 * Formata a chave de 44 dígitos em grupos legíveis:
 * cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) cNF(9) cDV(1)
 */
function formatChave(chave: string | null) {
  if (!chave || chave.length !== 44) return chave ?? '—';
  return [
    chave.slice(0, 2),
    chave.slice(2, 6),
    chave.slice(6, 20),
    chave.slice(20, 22),
    chave.slice(22, 25),
    chave.slice(25, 34),
    chave.slice(34, 43),
    chave.slice(43),
  ].join(' ');
}

function manifestacaoBadge(m: UltimaManifestacao | null) {
  if (!m) return <span className="text-muted-foreground text-xs">—</span>;
  const base = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap';
  const shortLabel = EVENTOS.find((e) => e.codigo === m.tpEvento)?.shortLabel ?? m.xEvento;
  switch (m.status) {
    case 'ENVIADO':
      return <span className={`${base} bg-emerald-50 text-emerald-700`}><CheckCircleIcon size={10} />{shortLabel}</span>;
    case 'PENDENTE':
      return <span className={`${base} bg-amber-50 text-amber-700`}><ClockIcon size={10} />Pendente</span>;
    case 'REJEITADO':
      return <span className={`${base} bg-red-50 text-red-700`}><WarningIcon size={10} />Rejeitado</span>;
    case 'ERRO':
      return <span className={`${base} bg-orange-50 text-orange-700`}><WarningIcon size={10} />Erro</span>;
    default:
      return <span className={`${base} bg-muted text-muted-foreground`}>{m.status}</span>;
  }
}

function tipoBadge(tipo: TipoDocumento, eventoDescricao?: string | null) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap';
  switch (tipo) {
    case 'PROC_NFE':
      return <span className={`${base} bg-blue-50 text-blue-700`}>NF-e</span>;
    case 'PROC_EVENTO_NFE':
      return <span className={`${base} bg-purple-50 text-purple-700`}>{eventoDescricao || 'Evento NF-e'}</span>;
    case 'RES_NFE':
      return <span className={`${base} bg-amber-50 text-amber-700`}>Resumo NF-e</span>;
    case 'RES_EVENTO':
      return <span className={`${base} bg-slate-100 text-slate-600`}>{eventoDescricao || 'Resumo Evento'}</span>;
    default:
      return <span className={`${base} bg-muted text-muted-foreground`}>{tipo}</span>;
  }
}

function situacaoBadge(sit: string | null) {
  if (!sit) return <span className="text-muted-foreground text-xs">—</span>;
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap';
  if (sit === 'AUTORIZADA' || sit === '100')
    return <span className={`${base} bg-emerald-50 text-emerald-700`}>Autorizada</span>;
  if (sit.includes('CANC') || sit === 'CANCELADA' || sit === '101')
    return <span className={`${base} bg-red-50 text-red-700`}>Cancelada</span>;
  // cSitNFe do resNFe: 1=Autorizada, 2=Cancelada
  if (sit === '1') return <span className={`${base} bg-emerald-50 text-emerald-700`}>Autorizada</span>;
  if (sit === '2') return <span className={`${base} bg-red-50 text-red-700`}>Cancelada</span>;
  // Strings longas (ex: digVal SHA1 legacy) — ignorar
  if (sit.length > 10) return <span className="text-muted-foreground text-xs">—</span>;
  return <span className={`${base} bg-muted text-muted-foreground`}>{sit}</span>;
}

function etiquetaTextColor(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#111827' : '#ffffff';
}

function EtiquetasBadges({
  etiquetas,
  onClick,
}: Readonly<{ etiquetas: Etiqueta[]; onClick: () => void }>) {
  const MAX = 2;
  const visible = etiquetas.slice(0, MAX);
  const extra = etiquetas.length - MAX;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 flex-wrap group"
      title={etiquetas.length === 0 ? 'Adicionar etiqueta' : etiquetas.map((e) => e.nome).join(', ')}
    >
      {visible.map((e) => (
        <span
          key={e.id}
          className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap leading-tight"
          style={{ backgroundColor: e.cor, color: etiquetaTextColor(e.cor) }}
        >
          {e.nome}
        </span>
      ))}
      {extra > 0 && (
        <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap bg-muted text-muted-foreground">
          +{extra}
        </span>
      )}
      {etiquetas.length === 0 && (
        <span className="inline-flex items-center gap-0.5 rounded-full border border-dashed px-1.5 py-0.5 text-[10px] text-muted-foreground group-hover:border-primary group-hover:text-primary transition-colors">
          <TagIcon size={8} />
          <span>+</span>
        </span>
      )}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* EtiquetasModal                                                      */
/* ─────────────────────────────────────────────────────────────────── */

type CheckState = 'checked' | 'unchecked' | 'indeterminate';

function EtiquetasModal({
  docs,
  etiquetas,
  onClose,
  onSuccess,
}: Readonly<{
  docs: DfeDocumento[];
  etiquetas: Etiqueta[];
  onClose: () => void;
  onSuccess: () => void;
}>) {
  const [saving, setSaving] = useState(false);

  // Compute initial state per etiqueta
  const initialStates = useMemo<Map<string, CheckState>>(() => {
    const map = new Map<string, CheckState>();
    for (const et of etiquetas) {
      const count = docs.filter((d) => d.etiquetas.some((e) => e.id === et.id)).length;
      if (count === 0) map.set(et.id, 'unchecked');
      else if (count === docs.length) map.set(et.id, 'checked');
      else map.set(et.id, 'indeterminate');
    }
    return map;
  }, [docs, etiquetas]);

  const [states, setStates] = useState<Map<string, CheckState>>(() => new Map(initialStates));

  const toggle = (id: string) => {
    setStates((prev) => {
      const next = new Map(prev);
      const cur = next.get(id) ?? 'unchecked';
      next.set(id, cur === 'checked' ? 'unchecked' : 'checked');
      return next;
    });
  };

  const handleSave = async () => {
    const adicionar: string[] = [];
    const remover: string[] = [];
    for (const et of etiquetas) {
      const initial = initialStates.get(et.id) ?? 'unchecked';
      const final = states.get(et.id) ?? 'unchecked';
      if (final === 'checked' && initial !== 'checked') adicionar.push(et.id);
      else if (final === 'unchecked' && initial !== 'unchecked') remover.push(et.id);
    }
    if (adicionar.length === 0 && remover.length === 0) { onClose(); return; }
    setSaving(true);
    try {
      await api.post('/etiquetas/documentos/associar', {
        documentoIds: docs.map((d) => d.id),
        adicionar,
        remover,
      });
      onSuccess();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const isSingle = docs.length === 1;

  return createPortal(
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-sm bg-card rounded-xl border shadow-xl flex flex-col max-h-[80vh]">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="font-semibold text-foreground">Etiquetas</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isSingle
                  ? 'Selecione as etiquetas para este documento'
                  : `${docs.length} documentos selecionados`}
              </p>
            </div>
            <button type="button" title="Fechar" onClick={onClose}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted transition-colors">
              <XIcon size={18} />
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1">
            {etiquetas.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Nenhuma etiqueta cadastrada.
              </p>
            ) : (
              etiquetas.map((et) => {
                const state = states.get(et.id) ?? 'unchecked';
                return (
                  <button
                    key={et.id}
                    type="button"
                    title={et.nome}
                    onClick={() => { toggle(et.id); }}
                    className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted transition-colors text-left"
                  >
                    {/* Checkbox visual */}
                    <span className={[
                      'shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors',
                      state === 'checked' ? 'bg-primary border-primary' : 'border-input',
                    ].join(' ')}>
                      {state === 'checked' && <CheckCircleIcon size={10} weight="bold" className="text-primary-foreground" />}
                      {state === 'indeterminate' && <span className="w-2 h-0.5 rounded bg-muted-foreground" />}
                    </span>
                    {/* Color pill */}
                    <span
                      className="shrink-0 w-3 h-3 rounded-full"
                      style={{ backgroundColor: et.cor }}
                    />
                    <span className="flex-1 text-sm text-foreground">{et.nome}</span>
                    {state === 'indeterminate' && (
                      <span className="text-[10px] text-muted-foreground">parcial</span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="border-t px-5 py-4 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose}
              className="rounded-lg border px-4 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors">
              Cancelar
            </button>
            <button type="button" onClick={() => { void handleSave(); }} disabled={saving}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors">
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Manifestações Panel                                                 */
/* ─────────────────────────────────────────────────────────────────── */

function ManifestoesPanel({
  documento,
  onClose,
}: Readonly<{ documento: DfeDocumento; onClose: () => void }>) {
  const [manifestacoes, setManifestacoes] = useState<ManifestacaoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { nNF, serie, modelo } = parseChave(documento.chaveAcesso);

  useEffect(() => {
    setLoading(true);
    api
      .get(`/dfe/manifestacoes?documentoId=${documento.id}&limit=50`)
      .then((res) => {
        const data = res.data as { data: ManifestacaoItem[] };
        setManifestacoes(data.data);
      })
      .catch(() => {})
      .finally(() => { setLoading(false); });
  }, [documento.id]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-card shadow-xl border-l flex flex-col">
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div className="min-w-0 flex-1 pr-3">
            <h2 className="font-semibold text-foreground">Manifestações do Documento</h2>
            {nNF ? (
              <p className="text-xs text-muted-foreground mt-0.5">
                NF-e {modelo}/{String(serie).padStart(3, '0')} — Nº {nNF}
              </p>
            ) : null}
            {documento.chaveAcesso ? (
              <p className="text-[10px] font-mono text-muted-foreground mt-1 break-all leading-relaxed">
                {formatChave(documento.chaveAcesso)}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            title="Fechar"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted transition-colors"
          >
            <XIcon size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <ArrowClockwiseIcon size={16} className="animate-spin" />
              <span className="text-sm">Carregando manifestações…</span>
            </div>
          ) : manifestacoes.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">
              Nenhuma manifestação registrada para este documento.
            </div>
          ) : (
            manifestacoes.map((m) => (
              <div key={m.id} className="rounded-lg border p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {manifestacaoBadge({
                      tpEvento: m.tpEvento,
                      xEvento: m.xEvento,
                      status: m.status,
                      nProt: m.nProt,
                      enviadoEm: m.enviadoEm,
                    })}
                    <span className="text-xs text-muted-foreground">Seq {m.nSeqEvento}</span>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(m.criadoEm)}</span>
                </div>
                {m.nProt ? (
                  <p className="text-xs font-mono text-foreground">nProt: {m.nProt}</p>
                ) : null}
                {m.cStat ? (
                  <p className="text-xs text-muted-foreground">
                    cStat {m.cStat}{m.xMotivo ? ` — ${m.xMotivo}` : ''}
                  </p>
                ) : null}
                {m.tentativas > 1 ? (
                  <p className="text-xs text-muted-foreground">{m.tentativas} tentativa{m.tentativas !== 1 ? 's' : ''}</p>
                ) : null}
                {m.enviadoEm ? (
                  <p className="text-xs text-muted-foreground">Enviado em {fmtDate(m.enviadoEm)}</p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Histórico de etiquetas — side panel                                 */
/* ─────────────────────────────────────────────────────────────────── */

function EtiquetaHistoricoPanel({
  documento,
  onClose,
}: Readonly<{ documento: DfeDocumento; onClose: () => void }>) {
  const [historico, setHistorico] = useState<EtiquetaHistoricoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { nNF, serie, modelo } = parseChave(documento.chaveAcesso);

  useEffect(() => {
    setLoading(true);
    api
      .get(`/etiquetas/historico/${documento.id}`)
      .then((res) => { setHistorico(res.data as EtiquetaHistoricoItem[]); })
      .catch(() => {})
      .finally(() => { setLoading(false); });
  }, [documento.id]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-card shadow-xl border-l flex flex-col">
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div className="min-w-0 flex-1 pr-3">
            <h2 className="font-semibold text-foreground">Histórico de Etiquetas</h2>
            {nNF ? (
              <p className="text-xs text-muted-foreground mt-0.5">
                NF-e {modelo}/{String(serie).padStart(3, '0')} — Nº {nNF}
              </p>
            ) : null}
          </div>
          <button type="button" title="Fechar" onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted transition-colors">
            <XIcon size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <ArrowClockwiseIcon size={16} className="animate-spin" />
              <span className="text-sm">Carregando histórico…</span>
            </div>
          ) : historico.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">
              Nenhuma alteração de etiqueta registrada para este documento.
            </div>
          ) : (
            historico.map((entry) => {
              const antesIds = new Set(entry.etiquetasAntes.map((e) => e.id));
              const depoisIds = new Set(entry.etiquetasDepois.map((e) => e.id));
              const removidas = entry.etiquetasAntes.filter((e) => !depoisIds.has(e.id));
              const adicionadas = entry.etiquetasDepois.filter((e) => !antesIds.has(e.id));
              const inalteradas = entry.etiquetasDepois.filter((e) => antesIds.has(e.id));

              return (
                <div key={entry.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">
                      {entry.usuario?.nome ?? 'Sistema'}
                    </span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {fmtDatetime(entry.criadoEm)}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {inalteradas.map((et) => (
                      <span
                        key={et.id}
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{ backgroundColor: et.cor, color: etiquetaTextColor(et.cor) }}
                      >
                        {et.nome}
                      </span>
                    ))}
                    {removidas.map((et) => (
                      <span
                        key={et.id}
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium line-through opacity-60 ring-1 ring-red-400 bg-red-50 text-red-700"
                      >
                        {et.nome}
                      </span>
                    ))}
                    {adicionadas.map((et) => (
                      <span
                        key={et.id}
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-green-400 bg-green-50 text-green-700"
                      >
                        +{et.nome}
                      </span>
                    ))}
                    {removidas.length === 0 && adicionadas.length === 0 && inalteradas.length === 0 ? (
                      <span className="text-xs text-muted-foreground">Sem etiquetas</span>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Ações Dropdown (portal-based to escape overflow:hidden)            */
/* ─────────────────────────────────────────────────────────────────── */

function AcoesDropdown({
  doc,
  onManifest,
  onVerManifestacoes,
  onDownloadXml,
  onDownloadDanfe,
  onHistoricoEtiquetas,
}: Readonly<{
  doc: DfeDocumento;
  onManifest: () => void;
  onVerManifestacoes: () => void;
  onDownloadXml: () => void;
  onDownloadDanfe: () => void;
  onHistoricoEtiquetas: () => void;
}>) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    let removeHandler: (() => void) | undefined;
    const timer = setTimeout(() => {
      const handler = () => { setOpen(false); };
      document.addEventListener('mousedown', handler);
      removeHandler = () => document.removeEventListener('mousedown', handler);
    }, 0);
    return () => {
      clearTimeout(timer);
      removeHandler?.();
    };
  }, [open]);

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen((v) => !v);
  };

  const hasChave = Boolean(doc.chaveAcesso);

  const item = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    disabled = false,
  ) => (
    <button
      key={label}
      type="button"
      disabled={disabled}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) { setOpen(false); onClick(); }
      }}
      className={[
        'flex w-full items-center gap-2 px-3 py-2 text-xs text-left transition-colors',
        disabled
          ? 'text-muted-foreground cursor-not-allowed'
          : 'text-foreground hover:bg-muted cursor-pointer',
      ].join(' ')}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {disabled ? <span className="text-[10px] text-muted-foreground/60 shrink-0">Em breve</span> : null}
    </button>
  );

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        title="Ações"
        onClick={handleOpen}
        className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <DotsThreeVerticalIcon size={15} weight="bold" />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={(el) => {
            if (el) {
              el.style.top = `${pos.top}px`;
              el.style.right = `${pos.right}px`;
            }
          }}
          className="fixed z-[100] w-52 rounded-xl border bg-card shadow-lg py-1"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {item('Manifestar', <HandWavingIcon size={13} />, onManifest, !hasChave)}
          {item('Baixar XML', <FileArrowDownIcon size={13} />, onDownloadXml, !hasChave)}
          {item('DANFE', <FilePdfIcon size={13} />, onDownloadDanfe, doc.tipoDocumento !== 'PROC_NFE')}
          {item('Carta de Correção', <FileTextIcon size={13} />, () => {}, true)}
          <div className="border-t my-1" />
          {item('Ver manifestações', <ListBulletsIcon size={13} />, onVerManifestacoes)}
          {item('Histórico de etiquetas', <TagIcon size={13} />, onHistoricoEtiquetas)}
        </div>,
        document.body,
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Manifestação Modal                                                  */
/* ─────────────────────────────────────────────────────────────────── */

function ManifestacaoModal({
  docs,
  onClose,
  onSuccess,
}: Readonly<{ docs: DfeDocumento[]; onClose: () => void; onSuccess: () => void }>) {
  const [tpEvento, setTpEvento] = useState<TpEvento>('210200');
  const [xJust, setXJust] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const evento = EVENTOS.find((e) => e.codigo === tpEvento)!;
  const docsComChave = docs.filter((d) => d.chaveAcesso);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (evento.exigeJust && xJust.length < 15) {
      setErro('Justificativa deve ter no mínimo 15 caracteres.');
      return;
    }
    if (docsComChave.length === 0) {
      setErro('Nenhum documento com chave de acesso selecionado.');
      return;
    }
    setEnviando(true);
    try {
      const results = await Promise.allSettled(
        docsComChave.map((doc) =>
          api.post(`/dfe/documentos/${doc.id}/manifestar`, {
            tpEvento,
            ...(evento.exigeJust ? { xJust } : {}),
          }),
        ),
      );
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failures.length === results.length) {
        const firstErr = failures[0].reason as { response?: { data?: { message?: string | string[] } } };
        const msg = firstErr?.response?.data?.message ?? 'Erro ao enviar manifestação para a SEFAZ.';
        setErro(Array.isArray(msg) ? msg.join('; ') : String(msg));
        return;
      }
      onSuccess();
      onClose();
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="font-semibold text-foreground">Manifestar Destinatário</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {docsComChave.length} documento{docsComChave.length !== 1 ? 's' : ''} selecionado{docsComChave.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button type="button" title="Fechar" onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted transition-colors">
            <XIcon size={18} />
          </button>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e); }} className="px-5 py-4 space-y-4">
          <div>
            <label htmlFor="tp-evento" className="block text-sm font-medium text-foreground mb-1.5">
              Tipo de manifestação
            </label>
            <select id="tp-evento" value={tpEvento}
              onChange={(e) => { setTpEvento(e.target.value as TpEvento); setErro(null); }}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
              {EVENTOS.map((ev) => (
                <option key={ev.codigo} value={ev.codigo}>{ev.codigo} — {ev.label}</option>
              ))}
            </select>
          </div>

          {evento.exigeJust ? (
            <div>
              <label htmlFor="xjust" className="block text-sm font-medium text-foreground mb-1.5">
                Justificativa <span className="text-red-500">*</span>
              </label>
              <textarea id="xjust" value={xJust}
                onChange={(e) => { setXJust(e.target.value); setErro(null); }}
                placeholder="Descreva o motivo (mínimo 15 caracteres)…"
                rows={3}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-none" />
              <p className="text-xs text-muted-foreground mt-1">{xJust.length} / mínimo 15 caracteres</p>
            </div>
          ) : null}

          {erro ? (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {erro}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="rounded-lg border px-4 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={enviando || docsComChave.length === 0}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {enviando ? <ArrowClockwiseIcon size={14} className="animate-spin" /> : <CheckCircleIcon size={14} />}
              {enviando ? 'Enviando…' : `Enviar para ${docsComChave.length} doc${docsComChave.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Toolbar                                                             */
/* ─────────────────────────────────────────────────────────────────── */

function Toolbar({
  total,
  tab,
  selectedDocs,
  onManifest,
  onEtiquetas,
  onExport,
  loading,
  onRefresh,
}: Readonly<{
  total: number;
  tab: TabId;
  selectedDocs: DfeDocumento[];
  onManifest: () => void;
  onEtiquetas: () => void;
  onExport: () => void;
  loading: boolean;
  onRefresh: () => void;
}>) {
  const TAB_LABELS: Record<TabId, string> = {
    recebidas: 'NF-e',
    emitidas: 'NF-e',
    transportador: 'NF-e',
    citadas: 'NF-e',
  };

  return (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          {TAB_LABELS[tab]} <span className="text-muted-foreground">{total.toLocaleString('pt-BR')} Registros</span>
        </span>
        {selectedDocs.length > 0 ? (
          <span className="rounded-full bg-primary/10 text-primary text-xs font-medium px-2 py-0.5">
            {selectedDocs.length} selecionado{selectedDocs.length !== 1 ? 's' : ''}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" title="Atualizar lista" onClick={onRefresh} disabled={loading}
          className="rounded-lg p-2 border text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40">
          <ArrowClockwiseIcon size={15} className={loading ? 'animate-spin' : ''} />
        </button>
        <button type="button" title="Exportar documentos filtrados para CSV" onClick={onExport}
          className="rounded-lg p-2 border text-muted-foreground hover:bg-muted transition-colors">
          <FileArrowDownIcon size={15} />
        </button>
        <button type="button" title="Gerenciar etiquetas dos documentos selecionados" onClick={onEtiquetas}
          disabled={selectedDocs.length === 0}
          className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-40 transition-colors">
          <TagIcon size={14} />
          Etiquetas
        </button>
        <button type="button" title="Manifestar documentos selecionados" onClick={onManifest}
          disabled={selectedDocs.filter((d) => d.chaveAcesso).length === 0}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors">
          <HandWavingIcon size={14} />
          Manifestar
          <CaretDownIcon size={12} />
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Table                                                               */
/* ─────────────────────────────────────────────────────────────────── */

function DocTable({
  docs,
  selected,
  onToggle,
  onToggleAll,
  onManifestSingle,
  onVerManifestacoes,
  onDownloadXml,
  onDownloadDanfe,
  onEtiquetasSingle,
  onHistoricoEtiquetas,
}: Readonly<{
  docs: DfeDocumento[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onManifestSingle: (doc: DfeDocumento) => void;
  onVerManifestacoes: (doc: DfeDocumento) => void;
  onDownloadXml: (doc: DfeDocumento) => void;
  onDownloadDanfe: (doc: DfeDocumento) => void;
  onEtiquetasSingle: (doc: DfeDocumento) => void;
  onHistoricoEtiquetas: (doc: DfeDocumento) => void;
}>) {
  const allSelected = docs.length > 0 && docs.every((d) => selected.has(d.id));

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableHead className="w-10 text-center">
              <button type="button" title={allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
                onClick={onToggleAll}
                className="text-muted-foreground hover:text-foreground transition-colors">
                {allSelected
                  ? <CheckSquareIcon size={15} weight="fill" className="text-primary" />
                  : <SquareIcon size={15} />}
              </button>
            </TableHead>
            <TableHead>Manifestação</TableHead>
            <TableHead>
              <span className="flex items-center gap-1"><TagIcon size={11} />Etiquetas</span>
            </TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Nº Doc</TableHead>
            <TableHead>CNPJ Emitente</TableHead>
            <TableHead>Nome Emitente</TableHead>
            <TableHead>Chave NF-e (44)</TableHead>
            <TableHead>Emissão</TableHead>
            <TableHead className="text-right">Valor Total</TableHead>
            <TableHead>Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {docs.map((doc) => {
            const { nNF } = parseChave(doc.chaveAcesso);
            const isSelected = selected.has(doc.id);
            return (
              <TableRow
                key={doc.id}
                className={`cursor-pointer ${isSelected ? 'bg-primary/5 hover:bg-primary/5' : 'hover:bg-muted/30'}`}
                onClick={() => { onToggle(doc.id); }}
              >
                <TableCell className="w-10 text-center" onClick={(e) => e.stopPropagation()}>
                  <button type="button" title={isSelected ? 'Desmarcar' : 'Selecionar'}
                    onClick={() => { onToggle(doc.id); }}
                    className="text-muted-foreground hover:text-foreground transition-colors">
                    {isSelected
                      ? <CheckSquareIcon size={15} weight="fill" className="text-primary" />
                      : <SquareIcon size={15} />}
                  </button>
                </TableCell>

                {/* Manifestação */}
                <TableCell>{manifestacaoBadge(doc.ultimaManifestacao)}</TableCell>

                {/* Etiquetas */}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <EtiquetasBadges
                    etiquetas={doc.etiquetas ?? []}
                    onClick={() => { onEtiquetasSingle(doc); }}
                  />
                </TableCell>

                {/* Tipo de documento */}
                <TableCell>{tipoBadge(doc.tipoDocumento, doc.eventoDescricao)}</TableCell>

                {/* Status do documento */}
                <TableCell>{situacaoBadge(doc.nfeSituacao)}</TableCell>

                {/* Nº Doc */}
                <TableCell className="text-right text-xs font-medium">{nNF ?? '—'}</TableCell>

                {/* CNPJ Emitente */}
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{maskCnpj(doc.nfeEmitenteCnpj)}</TableCell>

                {/* Nome Emitente */}
                <TableCell className="max-w-[160px] truncate text-xs" title={doc.nfeEmitenteNome ?? undefined}>
                  {doc.nfeEmitenteNome ?? '—'}
                </TableCell>

                {/* Chave completa 44 dígitos */}
                <TableCell>
                  {doc.chaveAcesso ? (
                    <span
                      className="font-mono text-xs text-muted-foreground tracking-tight whitespace-nowrap"
                      title={doc.chaveAcesso}
                    >
                      {formatChave(doc.chaveAcesso)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>

                {/* Data Emissão */}
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(doc.nfeDhEmissao)}</TableCell>

                {/* Valor Total */}
                <TableCell className="text-right text-xs tabular-nums font-medium whitespace-nowrap">
                  {fmtCurrency(doc.nfeValorTotal)}
                </TableCell>

                {/* Ações */}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <AcoesDropdown
                    doc={doc}
                    onManifest={() => { onManifestSingle(doc); }}
                    onVerManifestacoes={() => { onVerManifestacoes(doc); }}
                    onDownloadXml={() => { onDownloadXml(doc); }}
                    onDownloadDanfe={() => { onDownloadDanfe(doc); }}
                    onHistoricoEtiquetas={() => { onHistoricoEtiquetas(doc); }}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Etiqueta multi-select dropdown                                      */
/* ─────────────────────────────────────────────────────────────────── */

function EtiquetaMultiSelect({
  etiquetas,
  selected,
  onChange,
}: Readonly<{
  etiquetas: Etiqueta[];
  selected: string[];
  onChange: (ids: string[]) => void;
}>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => { document.removeEventListener('mousedown', handler); };
  }, []);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const label = selected.length === 0 ? 'Todas' : `${selected.length} etiqueta${selected.length !== 1 ? 's' : ''}`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Filtrar por etiquetas"
        onClick={() => { setOpen((v) => !v); }}
        className={[
          'flex items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm transition-colors whitespace-nowrap min-w-32',
          selected.length > 0 ? 'border-primary/50 text-primary bg-primary/5' : 'text-foreground hover:bg-muted',
        ].join(' ')}
      >
        <TagIcon size={13} className="shrink-0 text-muted-foreground" />
        <span className="flex-1 text-left">{label}</span>
        <CaretDownIcon size={11} className="shrink-0 text-muted-foreground" />
      </button>
      {open ? (
        <div className="absolute top-full left-0 mt-1 z-20 bg-card border rounded-lg shadow-lg min-w-44 max-h-52 overflow-y-auto py-1">
          {etiquetas.length === 0 ? (
            <p className="text-xs text-muted-foreground px-3 py-2">Nenhuma etiqueta cadastrada</p>
          ) : (
            etiquetas.map((et) => (
              <button
                key={et.id}
                type="button"
                title={et.nome}
                onClick={() => { toggle(et.id); }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-muted text-sm text-left"
              >
                <span className={[
                  'w-3.5 h-3.5 rounded border-2 shrink-0 flex items-center justify-center',
                  selected.includes(et.id) ? 'bg-primary border-primary' : 'border-input',
                ].join(' ')}>
                  {selected.includes(et.id) && <CheckCircleIcon size={8} weight="bold" className="text-primary-foreground" />}
                </span>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: et.cor }} />
                <span className="text-foreground">{et.nome}</span>
              </button>
            ))
          )}
          {selected.length > 0 ? (
            <div className="border-t mt-1 pt-1">
              <button
                type="button"
                title="Limpar seleção de etiquetas"
                onClick={() => { onChange([]); }}
                className="w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted text-left transition-colors"
              >
                Limpar seleção
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Filters bar                                                         */
/* ─────────────────────────────────────────────────────────────────── */

function FiltersBar({
  filters,
  setFilters,
  configs,
  etiquetas,
  onApply,
  onClear,
  hasActiveFilters,
}: Readonly<{
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  configs: DfeConfigItem[];
  etiquetas: Etiqueta[];
  onApply: () => void;
  onClear: () => void;
  hasActiveFilters: boolean;
}>) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [empresaAberta, setEmpresaAberta] = useState(false);
  const [empresaBusca, setEmpresaBusca] = useState('');
  const empresaComboRef = React.useRef<HTMLDivElement>(null);
  const upd = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const inputCls = 'rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring';

  const configSelecionada = configs.find((c) => c.id === filters.configId);
  // Normaliza: remove ./- para comparar CNPJ sem pontuação; aceita busca por razão social
  const configsFiltradas = (() => {
    const termo = empresaBusca.replace(/[.\-/]/g, '').toLowerCase();
    if (!termo) return configs;
    return configs.filter((c) => {
      const cnpjNorm = c.cnpj.replace(/[.\-/]/g, '').toLowerCase();
      const nome     = (c.nomeFantasia || c.nome || '').toLowerCase();
      return cnpjNorm.includes(termo) || nome.includes(termo);
    });
  })();

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (empresaComboRef.current && !empresaComboRef.current.contains(e.target as Node)) {
        setEmpresaAberta(false);
        setEmpresaBusca('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="shrink-0 border-b bg-card px-6 py-3 flex flex-col gap-[10px]">

      {/* Linha 1: Empresa / Razão Social — 420px fixo, compacto à esquerda */}
      <div className="flex items-end gap-[10px]">
        <div className="flex flex-col gap-1 w-[420px]" ref={empresaComboRef}>
          <label className="text-xs text-muted-foreground">Empresa / Razão Social</label>
          <div className="relative">
            <input
              type="text"
              autoComplete="off"
              placeholder="Todas as empresas — pesquise por CNPJ ou razão social"
              className={`${inputCls} w-full pr-7`}
              value={empresaAberta
                ? empresaBusca
                : configSelecionada
                  ? `${maskCnpj(configSelecionada.cnpj)} — ${configSelecionada.nomeFantasia || configSelecionada.nome || ''}`
                  : ''}
              onChange={(e) => { setEmpresaBusca(e.target.value); setEmpresaAberta(true); }}
              onFocus={() => { setEmpresaBusca(''); setEmpresaAberta(true); }}
            />
            <CaretDownIcon size={12}
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            {empresaAberta && (
              <div className="absolute z-50 mt-1 w-full min-w-[400px] rounded-md border border-input bg-background shadow-lg max-h-64 overflow-y-auto">
                <button type="button"
                  onClick={() => { upd('configId', ''); setEmpresaAberta(false); setEmpresaBusca(''); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors text-muted-foreground border-b border-input/30 ${!filters.configId ? 'bg-primary/5 font-medium' : ''}`}>
                  Todas as empresas
                </button>
                {configsFiltradas.length === 0 && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">Nenhuma empresa encontrada.</p>
                )}
                {configsFiltradas.map((c) => (
                  <button type="button" key={c.id}
                    onClick={() => { upd('configId', c.id); setEmpresaAberta(false); setEmpresaBusca(''); }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-baseline gap-2 ${filters.configId === c.id ? 'bg-primary/5 font-medium' : ''}`}>
                    <span className="font-mono text-xs text-muted-foreground shrink-0">{maskCnpj(c.cnpj)}</span>
                    <span className="text-foreground truncate">{c.nomeFantasia || c.nome || ''}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Linha 2: filtros + Raiz CNPJ + botões */}
      <div className="flex items-end gap-[10px] flex-wrap">
        <label className="flex items-center gap-1 cursor-pointer pb-[3px] shrink-0">
          <input type="checkbox" checked={filters.raizCnpj}
            onChange={(e) => { upd('raizCnpj', e.target.checked); }}
            className="rounded accent-primary" />
          <span className="text-xs text-foreground whitespace-nowrap">Raiz CNPJ</span>
        </label>

        <div className="flex flex-col gap-1 flex-1 min-w-36">
          <label htmlFor="f-chave" className="text-xs text-muted-foreground">Chave NF-e</label>
          <input id="f-chave" type="text" placeholder="44 dígitos…" value={filters.chaveAcesso}
            onChange={(e) => { upd('chaveAcesso', e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter') onApply(); }}
            className={`${inputCls} w-full`} />
        </div>

        <div className="flex flex-col gap-1 shrink-0">
          <label htmlFor="f-cnpj" className="text-xs text-muted-foreground">CNPJ Emitente</label>
          <input id="f-cnpj" type="text" placeholder="00.000.000/0001-00" value={filters.cnpjEmitente}
            onChange={(e) => { upd('cnpjEmitente', e.target.value); }}
            className={`${inputCls} w-40`} />
        </div>

        <div className="flex flex-col gap-1 shrink-0">
          <label htmlFor="f-nnf" className="text-xs text-muted-foreground">Nº Doc</label>
          <input id="f-nnf" type="text" placeholder="519104" value={filters.nNF}
            onChange={(e) => { upd('nNF', e.target.value.replace(/\D/g, '')); }}
            onKeyDown={(e) => { if (e.key === 'Enter') onApply(); }}
            className={`${inputCls} w-24`} />
        </div>

        <div className="flex flex-col gap-1 shrink-0">
          <label htmlFor="f-di" className="text-xs text-muted-foreground">Emissão a partir</label>
          <input id="f-di" type="date" title="Emissão a partir" value={filters.dataInicio}
            onChange={(e) => { upd('dataInicio', e.target.value); }}
            className={inputCls} />
        </div>

        <div className="flex flex-col gap-1 shrink-0">
          <label htmlFor="f-df" className="text-xs text-muted-foreground">Emissão até</label>
          <input id="f-df" type="date" title="Emissão até" value={filters.dataFim}
            onChange={(e) => { upd('dataFim', e.target.value); }}
            className={inputCls} />
        </div>

        <div className="flex flex-col gap-1 shrink-0">
          <span className="text-xs text-muted-foreground invisible">toggle</span>
          <button type="button" onClick={() => { setShowAdvanced((v) => !v); }}
            className={[
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition-colors whitespace-nowrap',
              showAdvanced ? 'bg-primary/10 text-primary border-primary/30' : 'text-muted-foreground hover:bg-muted',
            ].join(' ')}>
            Avançado
            <span className={`w-6 h-3.5 rounded-full transition-colors shrink-0 ${showAdvanced ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
              <span className={`block w-2.5 h-2.5 mt-0.5 rounded-full bg-white shadow transition-transform ${showAdvanced ? 'translate-x-3' : 'translate-x-0.5'}`} />
            </span>
          </button>
        </div>

        <div className="flex flex-col gap-1 shrink-0">
          <span className="text-xs text-muted-foreground invisible">btn</span>
          <div className="flex items-center gap-[10px]">
            <button type="button" onClick={onApply}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
              <FunnelIcon size={14} />Filtrar
            </button>
            {hasActiveFilters ? (
              <button type="button" onClick={onClear}
                className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors">
                <XIcon size={13} />Limpar
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Linha avançada */}
      {showAdvanced ? (
        <div className="flex flex-wrap gap-2 items-end pt-2 border-t">
          <div className="flex flex-col gap-1">
            <label htmlFor="f-valor-min" className="text-xs font-medium text-muted-foreground">Valor de</label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">R$</span>
              <input id="f-valor-min" type="number" min={0} step="0.01" placeholder="0,00" value={filters.valorMin}
                onChange={(e) => { upd('valorMin', e.target.value); }}
                className={`${inputCls} w-28 pl-7`} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="f-valor-max" className="text-xs font-medium text-muted-foreground">Valor até</label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">R$</span>
              <input id="f-valor-max" type="number" min={0} step="0.01" placeholder="0,00" value={filters.valorMax}
                onChange={(e) => { upd('valorMax', e.target.value); }}
                className={`${inputCls} w-28 pl-7`} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="f-tipo" className="text-xs font-medium text-muted-foreground">Tipo de documento</label>
            <select id="f-tipo" value={filters.tipo}
              onChange={(e) => { upd('tipo', e.target.value); }}
              className={inputCls}>
              <option value="">Todos</option>
              <option value="PROC_NFE">NF-e</option>
              <option value="PROC_EVENTO_NFE">Evento NF-e</option>
              <option value="RES_NFE">Resumo NF-e</option>
              <option value="RES_EVENTO">Resumo Evento</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Etiquetas</span>
            <EtiquetaMultiSelect
              etiquetas={etiquetas}
              selected={filters.etiquetaIds}
              onChange={(ids) => { upd('etiquetaIds', ids); }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Pagination                                                          */
/* ─────────────────────────────────────────────────────────────────── */

function Pagination({ meta, page, onPage }: Readonly<{ meta: PageMeta; page: number; onPage: (p: number) => void }>) {
  if (meta.totalPages <= 1) return null;
  const pages = Array.from({ length: Math.min(7, meta.totalPages) }, (_, i) => {
    if (meta.totalPages <= 7) return i + 1;
    if (page <= 4) return i + 1;
    if (page >= meta.totalPages - 3) return meta.totalPages - 6 + i;
    return page - 3 + i;
  });
  return (
    <div className="shrink-0 border-t bg-card px-6 py-3 flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        Página <span className="font-medium text-foreground">{meta.page}</span> de{' '}
        <span className="font-medium text-foreground">{meta.totalPages}</span>
        {' '}— {meta.total.toLocaleString('pt-BR')} registros
      </p>
      <div className="flex items-center gap-1">
        <button type="button" title="Anterior" disabled={page <= 1} onClick={() => { onPage(page - 1); }}
          className="rounded-lg p-2 text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors">
          <ArrowLeftIcon size={16} />
        </button>
        {pages.map((p) => (
          <button key={p} type="button" title={`Página ${p}`} onClick={() => { onPage(p); }}
            className={['rounded-lg min-w-[2rem] px-2 py-1 text-sm transition-colors',
              p === page ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'].join(' ')}>
            {p}
          </button>
        ))}
        <button type="button" title="Próxima" disabled={page >= meta.totalPages} onClick={() => { onPage(page + 1); }}
          className="rounded-lg p-2 text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors">
          <ArrowRightIcon size={16} />
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Empty state                                                         */
/* ─────────────────────────────────────────────────────────────────── */

function EmptyState({ tab, hasFilters }: Readonly<{ tab: TabId; hasFilters: boolean }>) {
  if (tab !== 'recebidas') {
    return (
      <div className="flex flex-col items-center justify-center h-60 text-center">
        <FileTextIcon size={48} className="text-muted-foreground/20 mb-4" />
        <p className="text-foreground font-medium mb-1">Sem documentos nesta aba</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          Documentos {tab === 'emitidas' ? 'emitidos pelo CNPJ monitorado' : `como ${tab}`} aparecerão aqui.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center h-60 text-center">
      <FileTextIcon size={48} className="text-muted-foreground/20 mb-4" />
      <p className="text-foreground font-medium mb-1">Nenhum documento encontrado</p>
      <p className="text-sm text-muted-foreground max-w-sm">
        {hasFilters
          ? 'Tente ajustar os filtros para encontrar o documento desejado.'
          : 'Os documentos fiscais capturados aparecerão aqui automaticamente.'}
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Page                                                                */
/* ─────────────────────────────────────────────────────────────────── */

const EMPTY_FILTERS: Filters = {
  configId: '', raizCnpj: false, cnpj: '', cnpjEmitente: '',
  chaveAcesso: '', nNF: '', valorMin: '', valorMax: '',
  dataInicio: '', dataFim: '', tipo: '', etiquetaIds: [],
};

export default function DfeDocumentosPage() {
  const [docs, setDocs] = useState<DfeDocumento[]>([]);
  const [meta, setMeta] = useState<PageMeta>({ total: 0, page: 1, limit: 20, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [activeFilters, setActiveFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<TabId>('recebidas');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [configs, setConfigs] = useState<DfeConfigItem[]>([]);
  const configsRef = useRef<DfeConfigItem[]>([]);
  const [modalDocs, setModalDocs] = useState<DfeDocumento[] | null>(null);
  const [panelDoc, setPanelDoc] = useState<DfeDocumento | null>(null);
  const [etiquetasLista, setEtiquetasLista] = useState<Etiqueta[]>([]);
  const [etiquetasModalDocs, setEtiquetasModalDocs] = useState<DfeDocumento[] | null>(null);
  const [historicoDoc, setHistoricoDoc] = useState<DfeDocumento | null>(null);
  const { toasts, success: toastSuccess, error: toastError, dismiss } = useToast();

  useEffect(() => {
    api.get('/dfe/status').then((res) => {
      const data = res.data as { id: string; cnpj: string; nome: string | null; nomeFantasia: string | null }[];
      const items = data.map((c) => ({ id: c.id, cnpj: c.cnpj, nome: c.nome, nomeFantasia: c.nomeFantasia }));
      setConfigs(items);
      configsRef.current = items;
    }).catch(() => {});
    api.get('/etiquetas').then((res) => {
      const data = res.data as Etiqueta[];
      setEtiquetasLista(data);
    }).catch(() => {});
  }, []);

  const buscar = useCallback(async (f: Filters, p: number, t: TabId) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: '20' });
      if (f.configId) params.set('configId', f.configId);
      if (f.raizCnpj) params.set('raizCnpj', 'true');

      const cnpjMonitorado = f.configId
        ? configsRef.current.find((c) => c.id === f.configId)?.cnpj
        : f.cnpj ? f.cnpj.replace(/\D/g, '') : undefined;

      // Regras das 4 abas:
      // EMITIDAS    → nfeEmitenteCnpj = X  (X emitiu a NF-e, tipo PROC_NFE)
      // TRANSPORTADOR → nfeTransportadorCnpj = X  (X transportou, tipo PROC_NFE)
      // CITADAS     → nfeAutXmlCnpjs CONTAINS X  (X autorizado a baixar o XML)
      // RECEBIDAS   → (cnpjDestinatario = X OR nfeDestinatarioCnpj = X)
      //               AND X não é emitente, não é transportador, não está em autXML
      if (t === 'emitidas') {
        params.set('tipo', 'PROC_NFE');
        if (cnpjMonitorado) params.set('cnpjEmitente', cnpjMonitorado);
      } else if (t === 'transportador') {
        params.set('tipo', 'PROC_NFE');
        if (cnpjMonitorado) params.set('cnpjTransportador', cnpjMonitorado);
      } else if (t === 'citadas') {
        if (cnpjMonitorado) params.set('cnpjAutXml', cnpjMonitorado);
      } else {
        // recebidas
        params.set('excluirOutrosPapeis', 'true');
        if (f.cnpj) params.set('cnpj', f.cnpj.replace(/\D/g, ''));
        if (f.cnpjEmitente) params.set('cnpjEmitente', f.cnpjEmitente.replace(/\D/g, ''));
        if (f.tipo) params.set('tipo', f.tipo);
      }

      if (f.chaveAcesso) params.set('chaveAcesso', f.chaveAcesso.replace(/\D/g, ''));
      if (f.dataInicio) params.set('dataInicio', f.dataInicio);
      if (f.dataFim) params.set('dataFim', f.dataFim);
      if (f.valorMin) params.set('valorMin', f.valorMin);
      if (f.valorMax) params.set('valorMax', f.valorMax);
      if (f.nNF) params.set('nNF', f.nNF);
      if (f.etiquetaIds.length > 0) params.set('etiquetaIds', f.etiquetaIds.join(','));

      const res = await api.get(`/dfe/documentos?${params.toString()}`);
      const body = res.data as { data: DfeDocumento[]; meta: PageMeta };
      setDocs(body.data);
      setMeta(body.meta);
      setSelected(new Set());
    } catch {
      toastError('Erro ao carregar documentos');
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => { void buscar(activeFilters, page, tab); }, [buscar, activeFilters, page, tab]);

  const hasActiveFilters = useMemo(() =>
    Object.entries(activeFilters).some(([k, v]) =>
      k !== 'raizCnpj' && (Array.isArray(v) ? v.length > 0 : Boolean(v)),
    ),
    [activeFilters]);

  const aplicar = () => { setPage(1); setActiveFilters({ ...filters }); };
  const limpar = () => { setFilters(EMPTY_FILTERS); setActiveFilters(EMPTY_FILTERS); setPage(1); };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (docs.every((d) => selected.has(d.id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(docs.map((d) => d.id)));
    }
  };

  const selectedDocs = docs.filter((d) => selected.has(d.id));

  const handleManifestSuccess = () => {
    toastSuccess('Manifestação(ões) enviada(s) com sucesso');
    void buscar(activeFilters, page, tab);
  };

  const openManifestModal = (targetDocs: DfeDocumento[]) => {
    if (targetDocs.filter((d) => d.chaveAcesso).length === 0) {
      toastError('Nenhum documento selecionado possui chave de acesso');
      return;
    }
    setModalDocs(targetDocs);
  };

  const handleEtiquetasSuccess = () => {
    toastSuccess('Etiquetas atualizadas');
    void buscar(activeFilters, page, tab);
  };

  const exportarCsv = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      const f = activeFilters;
      if (f.configId) params.set('configId', f.configId);
      if (f.raizCnpj) params.set('raizCnpj', 'true');
      if (f.chaveAcesso) params.set('chaveAcesso', f.chaveAcesso.replace(/\D/g, ''));
      if (f.cnpjEmitente) params.set('cnpjEmitente', f.cnpjEmitente.replace(/\D/g, ''));
      if (f.dataInicio) params.set('dataInicio', f.dataInicio);
      if (f.dataFim) params.set('dataFim', f.dataFim);
      if (f.valorMin) params.set('valorMin', f.valorMin);
      if (f.valorMax) params.set('valorMax', f.valorMax);
      if (f.nNF) params.set('nNF', f.nNF);
      if (f.tipo) params.set('tipo', f.tipo);
      if (f.etiquetaIds.length > 0) params.set('etiquetaIds', f.etiquetaIds.join(','));
      // aplicar filtros de tab
      const cnpjMonitorado = f.configId
        ? configsRef.current.find((c) => c.id === f.configId)?.cnpj
        : f.cnpj ? f.cnpj.replace(/\D/g, '') : undefined;
      if (tab === 'emitidas') {
        params.set('tipo', 'PROC_NFE');
        if (cnpjMonitorado) params.set('cnpjEmitente', cnpjMonitorado);
      } else if (tab === 'transportador') {
        params.set('tipo', 'PROC_NFE');
        if (cnpjMonitorado) params.set('cnpjTransportador', cnpjMonitorado);
      } else if (tab === 'citadas') {
        if (cnpjMonitorado) params.set('cnpjAutXml', cnpjMonitorado);
      } else {
        params.set('excluirOutrosPapeis', 'true');
      }

      const res = await api.get(`/dfe/documentos/exportar?${params.toString()}`, { responseType: 'blob' });
      const blob = res.data as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nf-es-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toastError('Erro ao exportar documentos');
    }
  }, [activeFilters, tab, toastError]);

  const downloadXml = useCallback(async (doc: DfeDocumento) => {
    try {
      const res = await api.get(`/dfe/documentos/${doc.id}/xml`, { responseType: 'blob' });
      const blob = res.data as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc.chaveAcesso ?? doc.id}.xml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toastError('Erro ao baixar XML do documento');
    }
  }, [toastError]);

  const downloadDanfe = useCallback(async (doc: DfeDocumento) => {
    try {
      const res = await api.get(`/dfe/documentos/${doc.id}/danfe`, { responseType: 'blob' });
      const blob = res.data as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DANFE-${doc.chaveAcesso ?? doc.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toastError('Erro ao gerar DANFE. Verifique se o documento é uma NF-e completa (procNFe).');
    }
  }, [toastError]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 border-b bg-card px-6 py-4">
        <div className="flex items-center gap-3">
          <Link href="/dfe"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Voltar para DFe">
            <ArrowLeftIcon size={18} />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Documentos Fiscais Capturados</h1>
            <p className="text-sm text-muted-foreground mt-0.5">NF-e e eventos recebidos via DFe de interesse</p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <FiltersBar
        filters={filters}
        setFilters={setFilters}
        configs={configs}
        etiquetas={etiquetasLista}
        onApply={aplicar}
        onClear={limpar}
        hasActiveFilters={hasActiveFilters}
      />

      {/* Tabs + Toolbar */}
      <div className="shrink-0 border-b bg-card px-6">
        <div className="flex items-center justify-between flex-wrap gap-2 pt-2">
          <div className="flex gap-0">
            {TABS.map((t) => (
              <button key={t.id} type="button"
                onClick={() => { setTab(t.id); setPage(1); setSelected(new Set()); }}
                className={[
                  'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                  tab === t.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                ].join(' ')}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="pb-2">
            <Toolbar
              total={meta.total}
              tab={tab}
              selectedDocs={selectedDocs}
              onManifest={() => { openManifestModal(selectedDocs); }}
              onEtiquetas={() => { setEtiquetasModalDocs(selectedDocs); }}
              onExport={() => { void exportarCsv(); }}
              loading={loading}
              onRefresh={() => { void buscar(activeFilters, page, tab); }}
            />
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
            <ArrowClockwiseIcon size={18} className="animate-spin" />
            <span className="text-sm">Carregando documentos…</span>
          </div>
        ) : docs.length === 0 ? (
          <EmptyState tab={tab} hasFilters={hasActiveFilters} />
        ) : (
          <DocTable
            docs={docs}
            selected={selected}
            onToggle={toggleSelect}
            onToggleAll={toggleAll}
            onManifestSingle={(doc) => { openManifestModal([doc]); }}
            onVerManifestacoes={(doc) => { setPanelDoc(doc); }}
            onDownloadXml={(doc) => { void downloadXml(doc); }}
            onDownloadDanfe={(doc) => { void downloadDanfe(doc); }}
            onEtiquetasSingle={(doc) => { setEtiquetasModalDocs([doc]); }}
            onHistoricoEtiquetas={(doc) => { setHistoricoDoc(doc); }}
          />
        )}
      </div>

      <Pagination meta={meta} page={page} onPage={setPage} />

      {/* Modal de manifestação */}
      {modalDocs ? (
        <ManifestacaoModal
          docs={modalDocs}
          onClose={() => { setModalDocs(null); }}
          onSuccess={handleManifestSuccess}
        />
      ) : null}

      {/* Painel lateral de manifestações do documento */}
      {panelDoc ? (
        <ManifestoesPanel
          documento={panelDoc}
          onClose={() => { setPanelDoc(null); }}
        />
      ) : null}

      {/* Modal de etiquetas */}
      {etiquetasModalDocs ? (
        <EtiquetasModal
          docs={etiquetasModalDocs}
          etiquetas={etiquetasLista}
          onClose={() => { setEtiquetasModalDocs(null); }}
          onSuccess={handleEtiquetasSuccess}
        />
      ) : null}

      {/* Painel de histórico de etiquetas */}
      {historicoDoc ? (
        <EtiquetaHistoricoPanel
          documento={historicoDoc}
          onClose={() => { setHistoricoDoc(null); }}
        />
      ) : null}

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
