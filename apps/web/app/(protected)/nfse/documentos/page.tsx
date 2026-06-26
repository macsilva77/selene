'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  GearIcon,
  XIcon,
  FunnelIcon,
  CaretDownIcon,
  CheckCircleIcon,
  ProhibitIcon,
  FilePdfIcon,
  TagIcon,
  DotsThreeVerticalIcon,
  EyeIcon,
  MapPinIcon,
} from '@phosphor-icons/react';

const inputCls =
  'rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring';
import { api } from '@/lib/api';
import { useToast, ToastContainer } from '@/components/ui/toast';
import { useEmpresaSelecionada } from '@/lib/empresa-selecionada';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';

/* ───────────────────────────── Types ───────────────────────────── */

type Papel = 'PRESTADOR' | 'TOMADOR' | 'INTERMEDIARIO';

interface Etiqueta {
  id: string;
  nome: string;
  cor: string;
}

interface NfseDoc {
  id: string;
  chaveAcesso: string;
  numero: string | null;
  papelTitular: Papel;
  cnpjTitular: string;
  competencia: string | null;
  dhProcessamento: string | null;
  codMunIncidencia: string | null;
  munIncidenciaNome: string | null;
  prestadorDoc: string | null;
  prestadorNome: string | null;
  tomadorDoc: string | null;
  tomadorNome: string | null;
  codTribNac: string | null;
  descricaoServico: string | null;
  valorServico: string | null;
  valorIssqn: string | null;
  valorLiquido: string | null;
  tribIssqn: number | null;
  tpRetIssqn: number | null;
  cancelada: boolean;
  etiquetas: Etiqueta[];
}

interface NfseEvento {
  id: string;
  tipoEvento: string;
  descricaoEvento: string | null;
  nSeqEvento: number | null;
  dhProcessamento: string | null;
  motivoCodigo: string | null;
  motivoTexto: string | null;
}

interface NfseDocDetalhe extends NfseDoc {
  eventos: NfseEvento[];
  xml: string | null;
  aliquotaIssqn: string | null;
  valorBcIssqn: string | null;
}

interface Filtros {
  cnpj: string;
  prestadorDoc: string;
  chaveAcesso: string;
  numero: string;
  competenciaInicio: string;
  competenciaFim: string;
  cancelada: '' | 'true' | 'false';
  municipio: string;
}

const FILTROS_VAZIOS: Filtros = {
  cnpj: '',
  prestadorDoc: '',
  chaveAcesso: '',
  numero: '',
  competenciaInicio: '',
  competenciaFim: '',
  cancelada: '',
  municipio: '',
};

interface MunicipioAtendido {
  codigo: string;
  nome: string | null;
  uf: string;
  total: number;
}

const ABAS: { id: Papel; label: string }[] = [
  { id: 'TOMADOR', label: 'Recebidas' },
  { id: 'PRESTADOR', label: 'Emitidas' },
  { id: 'INTERMEDIARIO', label: 'Intermediário' },
];

const LIMIT = 30;

/* ───────────────────────────── Helpers ───────────────────────────── */

function maskCnpj(v: string | null): string {
  const d = (v ?? '').replace(/\D/g, '');
  if (d.length !== 14) return v ?? '—';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}
function fmtCompet(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}
function fmtMoney(v: string | null): string {
  if (v == null) return '—';
  const n = Number(v);
  return Number.isNaN(n) ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
/** Chave de 50 dígitos por blocos lógicos: município(7) amb(1) tipo(1) inscrição(14) número(13) AAAA-MM(6) cód(9)+DV(1). */
function fmtChave50(v: string): string {
  const d = (v ?? '').replace(/\D/g, '');
  if (d.length !== 50) return d.replace(/(.{4})/g, '$1 ').trim();
  return [d.slice(0, 7), d.slice(7, 8), d.slice(8, 9), d.slice(9, 23), d.slice(23, 36), d.slice(36, 40), d.slice(40, 50)].join(' ');
}
function etiquetaTextColor(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return '#111827';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#111827' : '#ffffff';
}

const PAPEL_LABEL: Record<Papel, string> = {
  PRESTADOR: 'Prestador',
  TOMADOR: 'Tomador',
  INTERMEDIARIO: 'Intermediário',
};
const PAPEL_CLASS: Record<Papel, string> = {
  PRESTADOR: 'bg-sky-50 text-sky-700',
  TOMADOR: 'bg-violet-50 text-violet-700',
  INTERMEDIARIO: 'bg-amber-50 text-amber-700',
};

function Badge({ children, className }: Readonly<{ children: React.ReactNode; className: string }>) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${className}`}>
      {children}
    </span>
  );
}
function Campo({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{children}</span>
    </div>
  );
}
function Secao({ titulo, children }: Readonly<{ titulo: string; children: React.ReactNode }>) {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
      {children}
    </div>
  );
}

/* ───────────────────────────── Etiquetas ───────────────────────────── */

function EtiquetasBadges({ etiquetas, onClick }: Readonly<{ etiquetas: Etiqueta[]; onClick: () => void }>) {
  const MAX = 2;
  const visible = etiquetas.slice(0, MAX);
  const extra = etiquetas.length - MAX;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
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
        <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
          +{extra}
        </span>
      )}
      {etiquetas.length === 0 && (
        <span className="inline-flex items-center gap-0.5 rounded-full border border-dashed px-1.5 py-0.5 text-[10px] text-muted-foreground group-hover:border-primary group-hover:text-primary transition-colors">
          <TagIcon size={9} /> +
        </span>
      )}
    </button>
  );
}

function EtiquetasModal({
  doc,
  disponiveis,
  onClose,
  onSuccess,
}: Readonly<{
  doc: NfseDoc;
  disponiveis: Etiqueta[];
  onClose: () => void;
  onSuccess: () => void;
}>) {
  const atuais = new Set(doc.etiquetas.map((e) => e.id));
  const [sel, setSel] = useState<Set<string>>(new Set(atuais));
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const salvar = async () => {
    setSaving(true);
    try {
      const adicionar = [...sel].filter((id) => !atuais.has(id));
      const remover = [...atuais].filter((id) => !sel.has(id));
      await api.post('/nfse/documentos/etiquetas', { documentoIds: [doc.id], adicionar, remover });
      onSuccess();
      onClose();
    } catch {
      /* toast tratado no chamador via recarregar */
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold">Etiquetas</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted">
            <XIcon size={18} />
          </button>
        </div>
        <div className="max-h-80 overflow-auto px-5 py-3 flex flex-col gap-1">
          {disponiveis.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              Nenhuma etiqueta criada.{' '}
              <a href="/etiquetas" className="text-primary underline">Criar etiquetas</a>.
            </p>
          ) : (
            disponiveis.map((e) => (
              <label key={e.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted cursor-pointer">
                <input type="checkbox" checked={sel.has(e.id)} onChange={() => toggle(e.id)} />
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: e.cor, color: etiquetaTextColor(e.cor) }}
                >
                  {e.nome}
                </span>
              </label>
            ))
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button onClick={onClose} className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted">
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={saving}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── Filtros ───────────────────────────── */

function CampoFiltro({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="flex flex-col gap-1 shrink-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function FiltersBar({
  filtros,
  setFiltros,
  empresas,
  municipios,
  onAplicar,
  onLimpar,
}: Readonly<{
  filtros: Filtros;
  setFiltros: React.Dispatch<React.SetStateAction<Filtros>>;
  empresas: { id: string; cnpj: string; nome: string }[];
  municipios: MunicipioAtendido[];
  onAplicar: () => void;
  onLimpar: () => void;
}>) {
  const set = <K extends keyof Filtros>(k: K, v: Filtros[K]) => setFiltros((f) => ({ ...f, [k]: v }));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [empAberta, setEmpAberta] = useState(false);
  const [empBusca, setEmpBusca] = useState('');
  const empRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (empRef.current && !empRef.current.contains(e.target as Node)) setEmpAberta(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const empSel = empresas.find((e) => e.cnpj === filtros.cnpj);
  const q = empBusca.toLowerCase().trim();
  const empFiltradas = empresas.filter(
    (e) => !q || e.cnpj.includes(q.replace(/\D/g, '')) || (e.nome ?? '').toLowerCase().includes(q),
  );
  const hasFiltros =
    filtros.cnpj || filtros.prestadorDoc || filtros.chaveAcesso || filtros.numero ||
    filtros.competenciaInicio || filtros.competenciaFim || filtros.cancelada || filtros.municipio;

  return (
    <div className="shrink-0 border-b bg-background px-6 py-3">
      <div className="rounded-lg border border-border bg-card px-4 py-3 flex flex-col gap-[10px]">
        {/* Linha 1: Empresa combobox */}
        <div className="flex items-end gap-[10px]">
          <div className="flex flex-col gap-1 w-[420px]" ref={empRef}>
            <label className="text-xs text-muted-foreground">Empresa / Razão Social</label>
            <div className="relative">
              <input
                type="text"
                autoComplete="off"
                placeholder="Todas as empresas — pesquise por CNPJ ou razão social"
                className={`${inputCls} w-full pr-7`}
                value={empAberta ? empBusca : empSel ? `${maskCnpj(empSel.cnpj)} — ${empSel.nome}` : ''}
                onChange={(e) => { setEmpBusca(e.target.value); setEmpAberta(true); }}
                onFocus={() => { setEmpBusca(''); setEmpAberta(true); }}
              />
              <CaretDownIcon size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              {empAberta && (
                <div className="absolute z-50 mt-1 w-full min-w-[400px] rounded-md border border-input bg-background shadow-lg max-h-64 overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => { set('cnpj', ''); setEmpAberta(false); setEmpBusca(''); }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors text-muted-foreground border-b border-input/30 ${!filtros.cnpj ? 'bg-primary/5 font-medium' : ''}`}
                  >
                    Todas as empresas
                  </button>
                  {empFiltradas.map((e) => (
                    <button
                      type="button"
                      key={e.id}
                      onClick={() => { set('cnpj', e.cnpj); setEmpAberta(false); setEmpBusca(''); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-baseline gap-2 ${filtros.cnpj === e.cnpj ? 'bg-primary/5 font-medium' : ''}`}
                    >
                      <span className="font-mono text-xs text-muted-foreground shrink-0">{maskCnpj(e.cnpj)}</span>
                      <span className="text-foreground truncate">{e.nome}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Linha 2: campos + Avançado + Filtrar */}
        <div className="flex items-end gap-[10px] flex-wrap">
          <CampoFiltro label="Chave NFS-e">
            <input className={`${inputCls} w-72`} placeholder="50 dígitos…" value={filtros.chaveAcesso} maxLength={50}
              onChange={(e) => set('chaveAcesso', e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && onAplicar()} />
          </CampoFiltro>
          <CampoFiltro label="CNPJ Prestador">
            <input className={`${inputCls} w-40`} placeholder="14 dígitos" value={filtros.prestadorDoc} maxLength={14}
              onChange={(e) => set('prestadorDoc', e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && onAplicar()} />
          </CampoFiltro>
          <CampoFiltro label="Nº NFS-e">
            <input className={`${inputCls} w-24`} value={filtros.numero}
              onChange={(e) => set('numero', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onAplicar()} />
          </CampoFiltro>
          <CampoFiltro label="Competência início">
            <input type="date" className={inputCls} value={filtros.competenciaInicio} onChange={(e) => set('competenciaInicio', e.target.value)} />
          </CampoFiltro>
          <CampoFiltro label="Competência fim">
            <input type="date" className={inputCls} value={filtros.competenciaFim} onChange={(e) => set('competenciaFim', e.target.value)} />
          </CampoFiltro>
          <div className="flex flex-col gap-1 shrink-0">
            <span className="text-xs text-muted-foreground invisible">t</span>
            <button type="button" onClick={() => setShowAdvanced((v) => !v)}
              className={['flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition-colors whitespace-nowrap', showAdvanced ? 'bg-primary/10 text-primary border-primary/30' : 'text-muted-foreground hover:bg-muted'].join(' ')}>
              Avançado
              <span className={`w-6 h-3.5 rounded-full transition-colors shrink-0 ${showAdvanced ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
                <span className={`block w-2.5 h-2.5 mt-0.5 rounded-full bg-white shadow transition-transform ${showAdvanced ? 'translate-x-3' : 'translate-x-0.5'}`} />
              </span>
            </button>
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <span className="text-xs text-muted-foreground invisible">b</span>
            <div className="flex items-center gap-[10px]">
              <button type="button" onClick={onAplicar} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
                <FunnelIcon size={14} />Filtrar
              </button>
              {hasFiltros ? (
                <button type="button" onClick={onLimpar} className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted transition-colors">
                  <XIcon size={13} />Limpar
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* Linha 3: Avançado */}
        {showAdvanced ? (
          <div className="flex flex-wrap gap-2 items-end pt-2 border-t">
            <CampoFiltro label="Município (ISS)">
              <select className={inputCls} value={filtros.municipio} onChange={(e) => set('municipio', e.target.value)}>
                <option value="">Todos os municípios atendidos</option>
                {municipios.map((m) => (
                  <option key={m.codigo} value={m.codigo}>{m.nome ?? m.codigo} ({m.total})</option>
                ))}
              </select>
            </CampoFiltro>
            <CampoFiltro label="Situação">
              <select className={inputCls} value={filtros.cancelada} onChange={(e) => set('cancelada', e.target.value as Filtros['cancelada'])}>
                <option value="">Todas</option>
                <option value="false">Ativas</option>
                <option value="true">Canceladas</option>
              </select>
            </CampoFiltro>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ───────────────────────────── Detalhe (drawer) ───────────────────────────── */

function DetalheDrawer({ docId, onClose }: Readonly<{ docId: string; onClose: () => void }>) {
  const [doc, setDoc] = useState<NfseDocDetalhe | null>(null);
  const [loading, setLoading] = useState(true);
  const [showXml, setShowXml] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [danfseErro, setDanfseErro] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get(`/nfse/documentos/${docId}`).then((res) => setDoc(res.data as NfseDocDetalhe)).catch(() => setDoc(null)).finally(() => setLoading(false));
  }, [docId]);

  const baixarDanfse = async () => {
    setDanfseErro(null);
    setBaixando(true);
    try {
      const res = await api.get(`/nfse/documentos/${docId}/danfse`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `danfse-${doc?.chaveAcesso ?? docId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setDanfseErro('Não foi possível obter o DANFSe no ADN.');
    } finally {
      setBaixando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-xl overflow-y-auto bg-card shadow-xl border-l border-border" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold">NFS-e recebida</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted"><XIcon size={18} /></button>
        </div>
        {loading && <p className="px-5 py-6 text-sm text-muted-foreground">Carregando…</p>}
        {!loading && !doc && <p className="px-5 py-6 text-sm text-red-600">Não foi possível carregar a NFS-e.</p>}
        {doc && (
          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={PAPEL_CLASS[doc.papelTitular]}>{PAPEL_LABEL[doc.papelTitular]}</Badge>
              {doc.cancelada ? <Badge className="bg-red-50 text-red-700">Cancelada</Badge> : <Badge className="bg-emerald-50 text-emerald-700">Ativa</Badge>}
              {doc.etiquetas.map((e) => (
                <span key={e.id} className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: e.cor, color: etiquetaTextColor(e.cor) }}>{e.nome}</span>
              ))}
              <button onClick={() => void baixarDanfse()} disabled={baixando} className="ml-auto flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50 transition-colors">
                <FilePdfIcon size={16} /> {baixando ? 'Gerando…' : 'DANFSe'}
              </button>
            </div>
            {danfseErro && <p className="text-xs text-red-600">{danfseErro}</p>}
            <Campo label="Chave de acesso"><span className="font-mono text-xs break-all">{fmtChave50(doc.chaveAcesso)}</span></Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Número">{doc.numero ?? '—'}</Campo>
              <Campo label="Competência">{fmtCompet(doc.competencia)}</Campo>
              <Campo label="Processamento">{fmtDate(doc.dhProcessamento)}</Campo>
              <Campo label="Mun. incidência (IBGE)">{doc.codMunIncidencia ?? '—'}</Campo>
            </div>
            <Secao titulo="Prestador">
              <Campo label="Documento">{maskCnpj(doc.prestadorDoc)}</Campo>
              <Campo label="Nome">{doc.prestadorNome ?? '—'}</Campo>
            </Secao>
            <Secao titulo="Tomador">
              <Campo label="Documento">{maskCnpj(doc.tomadorDoc)}</Campo>
              <Campo label="Nome">{doc.tomadorNome ?? '—'}</Campo>
            </Secao>
            <Secao titulo="Serviço">
              <Campo label="Cód. tributação nacional">{doc.codTribNac ?? '—'}</Campo>
              <Campo label="Descrição">{doc.descricaoServico ?? '—'}</Campo>
            </Secao>
            <Secao titulo="Valores (ISSQN)">
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Serviço">{fmtMoney(doc.valorServico)}</Campo>
                <Campo label="Base de cálculo">{fmtMoney(doc.valorBcIssqn)}</Campo>
                <Campo label="Alíquota">{doc.aliquotaIssqn ? `${doc.aliquotaIssqn}%` : '—'}</Campo>
                <Campo label="ISSQN">{fmtMoney(doc.valorIssqn)}</Campo>
                <Campo label="Líquido">{fmtMoney(doc.valorLiquido)}</Campo>
                <Campo label="Retenção ISSQN">{doc.tpRetIssqn === 2 ? 'Retido (tomador)' : doc.tpRetIssqn === 3 ? 'Retido (interm.)' : 'Não retido'}</Campo>
              </div>
            </Secao>
            <Secao titulo={`Eventos (${doc.eventos.length})`}>
              {doc.eventos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum evento vinculado.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {doc.eventos.map((ev) => (
                    <li key={ev.id} className="rounded-md border border-border px-3 py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{ev.descricaoEvento ?? ev.tipoEvento}</span>
                        <span className="text-xs text-muted-foreground">{fmtDate(ev.dhProcessamento)}</span>
                      </div>
                      {ev.motivoTexto && <p className="mt-1 text-xs text-muted-foreground">{ev.motivoTexto}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
            {doc.xml && (
              <div>
                <button onClick={() => setShowXml((s) => !s)} className="text-sm font-medium text-primary hover:underline">{showXml ? 'Ocultar XML' : 'Ver XML'}</button>
                {showXml && <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-[11px] leading-tight">{doc.xml}</pre>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── Ações (dropdown) ───────────────────────────── */

function AcoesDropdown({
  onDetalhe,
  onEtiquetas,
  onDanfse,
}: Readonly<{ onDetalhe: () => void; onEtiquetas: () => void; onDanfse: () => void }>) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: Math.max(8, r.right - 200) });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const item = (label: string, icon: React.ReactNode, fn: () => void) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setOpen(false);
        fn();
      }}
      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted transition-colors"
    >
      {icon} {label}
    </button>
  );

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        title="Ações"
        className="rounded-md p-1 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
      >
        <DotsThreeVerticalIcon size={18} />
      </button>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[90]" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
            <div className="fixed z-[100] w-52 rounded-xl border bg-card shadow-lg py-1" style={{ top: pos.top, left: pos.left }}>
              {item('Ver detalhe', <EyeIcon size={15} />, onDetalhe)}
              {item('Etiquetas', <TagIcon size={15} />, onEtiquetas)}
              {item('Baixar DANFSe', <FilePdfIcon size={15} />, onDanfse)}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

/* ───────────────────────────── Municípios atendidos (popup) ───────────────────────────── */

interface CoberturaResult {
  codigo: string;
  nome: string;
  uf: string;
  notasLocais: number;
  atendido: boolean;
  convenioErro: string | null;
}

function MunicipiosPopup({
  municipios,
  onClose,
}: Readonly<{ municipios: MunicipioAtendido[]; onClose: () => void }>) {
  const porUf: Record<string, MunicipioAtendido[]> = {};
  for (const m of municipios) (porUf[m.uf || '—'] ??= []).push(m);
  const ufs = Object.keys(porUf).sort();
  const totalNotas = municipios.reduce((s, m) => s + m.total, 0);

  const [termo, setTermo] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [resultado, setResultado] = useState<CoberturaResult | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const consultar = async () => {
    if (!termo.trim()) return;
    setErro(null);
    setResultado(null);
    setBuscando(true);
    try {
      const res = await api.get(`/nfse/cobertura?municipio=${encodeURIComponent(termo.trim())}`);
      setResultado(res.data as CoberturaResult);
    } catch (e) {
      setErro((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Município não encontrado.');
    } finally {
      setBuscando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[80vh] rounded-xl border border-border bg-card shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Municípios atendidos pela captura</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {municipios.length} municípios em {ufs.length} {ufs.length === 1 ? 'estado' : 'estados'} · {totalNotas.toLocaleString('pt-BR')} notas capturadas
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted">
            <XIcon size={18} />
          </button>
        </div>
        <div className="overflow-auto px-5 py-3 flex flex-col gap-3">
          <p className="text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2 leading-relaxed">
            Estes são os municípios integrados ao <strong>Sistema Nacional NFS-e</strong> dos quais já recebemos
            notas. A captura é <strong>nacional</strong> — qualquer município integrado aparece aqui automaticamente
            conforme novas notas chegam. Municípios que ainda não aderiram ao Sistema Nacional não distribuem pelo
            ADN e, portanto, não são captados por aqui.
          </p>

          {/* Consulta de cobertura de um município */}
          <div className="rounded-md border border-border p-3 flex flex-col gap-2">
            <span className="text-xs font-medium text-foreground">Consultar um município</span>
            <div className="flex items-center gap-2">
              <input
                className={`${inputCls} flex-1`}
                placeholder="Nome (ex.: Campinas) ou código IBGE (7 dígitos)"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && consultar()}
              />
              <button
                onClick={consultar}
                disabled={buscando || !termo.trim()}
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
              >
                {buscando ? 'Consultando…' : 'Consultar'}
              </button>
            </div>
            {erro && <p className="text-xs text-red-600">{erro}</p>}
            {resultado && (
              <div className="flex flex-col gap-1 border-t border-border pt-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground">{resultado.nome}/{resultado.uf}</span>
                  <span className="text-xs text-muted-foreground font-mono">{resultado.codigo}</span>
                  {resultado.atendido ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-xs font-medium">Atendido</span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-xs font-medium">Sem notas captadas</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">{resultado.notasLocais.toLocaleString('pt-BR')} nota(s) já captada(s) deste município.</span>
                {resultado.convenioErro ? (
                  <span className="text-xs text-muted-foreground">Convênio no ADN: não foi possível confirmar ({resultado.convenioErro.slice(0, 90)}).</span>
                ) : (
                  <span className="text-xs text-emerald-700">Convênio confirmado no ADN (integrado ao Sistema Nacional).</span>
                )}
              </div>
            )}
          </div>

          {municipios.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Nenhum município ainda — sincronize a recepção.</p>
          ) : (
            ufs.map((uf) => (
              <div key={uf}>
                <div className="text-xs font-semibold text-foreground mb-1.5">
                  {uf} <span className="text-muted-foreground font-normal">({porUf[uf].length})</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {porUf[uf]
                    .slice()
                    .sort((a, b) => b.total - a.total)
                    .map((m) => (
                      <span key={m.codigo} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
                        {m.nome ?? m.codigo}
                        <span className="text-muted-foreground tabular-nums">{m.total}</span>
                      </span>
                    ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── Página ───────────────────────────── */

export default function DocumentosNfsePage() {
  const { toasts, success, error: toastError, dismiss } = useToast();
  const { empresa } = useEmpresaSelecionada();

  const [docs, setDocs] = useState<NfseDoc[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [aba, setAba] = useState<Papel>('TOMADOR');

  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS);
  const [filtrosAplicados, setFiltrosAplicados] = useState<Filtros>(FILTROS_VAZIOS);
  const [empresas, setEmpresas] = useState<{ id: string; cnpj: string; nome: string }[]>([]);
  const [municipios, setMunicipios] = useState<MunicipioAtendido[]>([]);
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [etiquetaDoc, setEtiquetaDoc] = useState<NfseDoc | null>(null);
  const [showMunicipios, setShowMunicipios] = useState(false);

  useEffect(() => {
    if (empresa?.cnpj && !filtros.cnpj) {
      setFiltros((f) => ({ ...f, cnpj: empresa.cnpj }));
      setFiltrosAplicados((f) => ({ ...f, cnpj: empresa.cnpj }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa?.cnpj]);

  useEffect(() => {
    api.get('/empresas?limit=100').then((res) => setEmpresas(((res.data?.data ?? res.data ?? []) as { id: string; cnpj: string; nome: string }[]).filter((e) => e.cnpj))).catch(() => {});
    api.get('/etiquetas').then((res) => {
      const lst = (res.data?.data ?? res.data ?? []) as Etiqueta[];
      setEtiquetas(lst.map((e) => ({ id: e.id, nome: e.nome, cor: e.cor })));
    }).catch(() => {});
    api.get('/nfse/municipios').then((res) => setMunicipios((res.data ?? []) as MunicipioAtendido[])).catch(() => {});
  }, []);

  const carregarDocs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT), papel: aba });
      const f = filtrosAplicados;
      if (f.cnpj) params.set('cnpj', f.cnpj.replace(/\D/g, ''));
      if (f.prestadorDoc) params.set('prestadorDoc', f.prestadorDoc);
      if (f.chaveAcesso) params.set('chaveAcesso', f.chaveAcesso);
      if (f.competenciaInicio) params.set('competenciaInicio', f.competenciaInicio);
      if (f.competenciaFim) params.set('competenciaFim', f.competenciaFim);
      if (f.cancelada) params.set('cancelada', f.cancelada);
      if (f.municipio) params.set('municipio', f.municipio);
      const res = await api.get(`/nfse/documentos?${params.toString()}`);
      let itens = (res.data?.itens ?? []) as NfseDoc[];
      if (f.numero) itens = itens.filter((d) => (d.numero ?? '').includes(f.numero));
      setDocs(itens);
      setTotal((res.data?.total ?? 0) as number);
    } catch {
      toastError('Erro ao carregar NFS-e recebidas');
    } finally {
      setLoading(false);
    }
  }, [page, aba, filtrosAplicados, toastError]);

  useEffect(() => {
    void carregarDocs();
  }, [carregarDocs]);

  const aplicarFiltros = () => {
    setPage(1);
    setFiltrosAplicados(filtros);
  };
  const limparFiltros = () => {
    setFiltros(FILTROS_VAZIOS);
    setFiltrosAplicados(FILTROS_VAZIOS);
    setPage(1);
  };
  const trocarAba = (p: Papel) => {
    setAba(p);
    setPage(1);
  };

  const baixarDanfse = async (doc: NfseDoc) => {
    try {
      const res = await api.get(`/nfse/documentos/${doc.id}/danfse`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `danfse-${doc.chaveAcesso}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toastError('Não foi possível obter o DANFSe no ADN.');
    }
  };

  const totalPaginas = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="flex flex-col h-full">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      {/* Header */}
      <div className="shrink-0 border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/nfse" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" title="Voltar para DFe NFS-e">
              <ArrowLeftIcon size={18} />
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Documentos Fiscais Capturados</h1>
              <p className="text-sm text-muted-foreground mt-0.5">NFS-e recebidas via distribuição do ADN</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowMunicipios(true)} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors">
              <MapPinIcon size={16} /> Municípios{municipios.length ? ` (${municipios.length})` : ''}
            </button>
            <button onClick={() => void carregarDocs()} disabled={loading} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50 transition-colors">
              <ArrowClockwiseIcon size={16} /> Atualizar
            </button>
            <Link href="/nfse" className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors">
              <GearIcon size={16} /> Configurações
            </Link>
          </div>
        </div>
      </div>

      <FiltersBar filtros={filtros} setFiltros={setFiltros} empresas={empresas} municipios={municipios} onAplicar={aplicarFiltros} onLimpar={limparFiltros} />

      {/* Abas por papel */}
      <div className="shrink-0 border-b bg-card px-6">
        <div className="flex items-center gap-1">
          {ABAS.map((t) => (
            <button
              key={t.id}
              onClick={() => trocarAba(t.id)}
              className={`px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${aba === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              {t.label}
            </button>
          ))}
          <span className="ml-auto text-sm text-muted-foreground">{total.toLocaleString('pt-BR')} registro(s)</span>
        </div>
      </div>

      {/* Tabela */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead><span className="flex items-center gap-1"><TagIcon size={11} />Etiquetas</span></TableHead>
                <TableHead className="text-right">Nº</TableHead>
                <TableHead>Prestador</TableHead>
                <TableHead>Tomador</TableHead>
                <TableHead>Município (ISS)</TableHead>
                <TableHead>Chave NFS-e (50)</TableHead>
                <TableHead>Competência</TableHead>
                <TableHead className="text-right">ISSQN</TableHead>
                <TableHead className="text-right">Líquido</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-8">Carregando…</TableCell></TableRow>
              ) : docs.length === 0 ? (
                <TableRow><TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-8">Nenhuma NFS-e nesta aba com os filtros atuais.</TableCell></TableRow>
              ) : (
                docs.map((d) => (
                  <TableRow key={d.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => setDetalheId(d.id)}>
                    <TableCell onClick={(e) => e.stopPropagation()}><EtiquetasBadges etiquetas={d.etiquetas} onClick={() => setEtiquetaDoc(d)} /></TableCell>
                    <TableCell className="text-right text-xs font-medium">{d.numero ?? '—'}</TableCell>
                    <TableCell className="max-w-[180px] truncate text-xs" title={d.prestadorNome ?? ''}>{d.prestadorNome ?? maskCnpj(d.prestadorDoc)}</TableCell>
                    <TableCell className="max-w-[180px] truncate text-xs text-muted-foreground" title={d.tomadorNome ?? ''}>{d.tomadorNome ?? maskCnpj(d.tomadorDoc)}</TableCell>
                    <TableCell className="max-w-[150px] truncate text-xs" title={d.munIncidenciaNome ?? d.codMunIncidencia ?? ''}>{d.munIncidenciaNome ?? d.codMunIncidencia ?? '—'}</TableCell>
                    <TableCell><span className="font-mono text-xs text-muted-foreground tracking-tight whitespace-nowrap" title={d.chaveAcesso}>{fmtChave50(d.chaveAcesso)}</span></TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtCompet(d.competencia)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums whitespace-nowrap">{fmtMoney(d.valorIssqn)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums font-medium whitespace-nowrap">{fmtMoney(d.valorLiquido)}</TableCell>
                    <TableCell>
                      {d.cancelada ? (
                        <Badge className="bg-red-50 text-red-700"><ProhibitIcon size={12} className="mr-1" /> Cancelada</Badge>
                      ) : (
                        <Badge className="bg-emerald-50 text-emerald-700"><CheckCircleIcon size={12} className="mr-1" /> Ativa</Badge>
                      )}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <AcoesDropdown
                        onDetalhe={() => setDetalheId(d.id)}
                        onEtiquetas={() => setEtiquetaDoc(d)}
                        onDanfse={() => void baixarDanfse(d)}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Paginação */}
      <div className="shrink-0 border-t bg-card px-6 py-3 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Página {page} de {totalPaginas}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="rounded-md border px-3 py-1 hover:bg-muted disabled:opacity-50">Anterior</button>
          <button onClick={() => setPage((p) => Math.min(totalPaginas, p + 1))} disabled={page >= totalPaginas || loading} className="rounded-md border px-3 py-1 hover:bg-muted disabled:opacity-50">Próxima</button>
        </div>
      </div>

      {showMunicipios && <MunicipiosPopup municipios={municipios} onClose={() => setShowMunicipios(false)} />}
      {detalheId && <DetalheDrawer docId={detalheId} onClose={() => setDetalheId(null)} />}
      {etiquetaDoc && (
        <EtiquetasModal
          doc={etiquetaDoc}
          disponiveis={etiquetas}
          onClose={() => setEtiquetaDoc(null)}
          onSuccess={() => {
            success('Etiquetas atualizadas.');
            void carregarDocs();
          }}
        />
      )}
    </div>
  );
}
