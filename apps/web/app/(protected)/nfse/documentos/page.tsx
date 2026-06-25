'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowClockwiseIcon,
  GearIcon,
  XIcon,
  FunnelIcon,
  CheckCircleIcon,
  ProhibitIcon,
  CaretRightIcon,
  FilePdfIcon,
} from '@phosphor-icons/react';
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

interface NfseDoc {
  id: string;
  chaveAcesso: string;
  numero: string | null;
  papelTitular: Papel;
  cnpjTitular: string;
  competencia: string | null;
  dhProcessamento: string | null;
  codMunIncidencia: string | null;
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

interface Empresa {
  id: string;
  cnpj: string;
  nome: string;
}

interface Filtros {
  cnpj: string;
  papel: '' | Papel;
  chaveAcesso: string;
  competenciaInicio: string;
  competenciaFim: string;
  cancelada: '' | 'true' | 'false';
}

const FILTROS_VAZIOS: Filtros = {
  cnpj: '',
  papel: '',
  chaveAcesso: '',
  competenciaInicio: '',
  competenciaFim: '',
  cancelada: '',
};

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
function fmtChave(v: string): string {
  return (v ?? '').replace(/(.{4})/g, '$1 ').trim();
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

/* ───────────────────────────── Filtros ───────────────────────────── */

function FiltersBar({
  filtros,
  setFiltros,
  empresas,
  onAplicar,
  onLimpar,
}: Readonly<{
  filtros: Filtros;
  setFiltros: React.Dispatch<React.SetStateAction<Filtros>>;
  empresas: Empresa[];
  onAplicar: () => void;
  onLimpar: () => void;
}>) {
  const set = <K extends keyof Filtros>(k: K, v: Filtros[K]) => setFiltros((f) => ({ ...f, [k]: v }));
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 flex flex-col gap-[10px]">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <FunnelIcon size={16} /> Filtros
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Empresa (CNPJ)
          <select
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            value={filtros.cnpj}
            onChange={(e) => set('cnpj', e.target.value)}
          >
            <option value="">Todas</option>
            {empresas.map((emp) => (
              <option key={emp.id} value={emp.cnpj}>
                {maskCnpj(emp.cnpj)} — {emp.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Papel
          <select
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            value={filtros.papel}
            onChange={(e) => set('papel', e.target.value as Filtros['papel'])}
          >
            <option value="">Todos</option>
            <option value="PRESTADOR">Prestador</option>
            <option value="TOMADOR">Tomador</option>
            <option value="INTERMEDIARIO">Intermediário</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Chave de acesso
          <input
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            value={filtros.chaveAcesso}
            onChange={(e) => set('chaveAcesso', e.target.value.replace(/\D/g, ''))}
            placeholder="50 dígitos"
            maxLength={50}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Situação
          <select
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            value={filtros.cancelada}
            onChange={(e) => set('cancelada', e.target.value as Filtros['cancelada'])}
          >
            <option value="">Todas</option>
            <option value="false">Ativas</option>
            <option value="true">Canceladas</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Competência início
          <input
            type="date"
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            value={filtros.competenciaInicio}
            onChange={(e) => set('competenciaInicio', e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Competência fim
          <input
            type="date"
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            value={filtros.competenciaFim}
            onChange={(e) => set('competenciaFim', e.target.value)}
          />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onAplicar} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition">
          Aplicar filtros
        </button>
        <button onClick={onLimpar} className="rounded-lg border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors">
          Limpar
        </button>
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
    api
      .get(`/nfse/documentos/${docId}`)
      .then((res) => setDoc(res.data as NfseDocDetalhe))
      .catch(() => setDoc(null))
      .finally(() => setLoading(false));
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
      <div
        className="h-full w-full max-w-xl overflow-y-auto bg-card shadow-xl border-l border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold">NFS-e recebida</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted">
            <XIcon size={18} />
          </button>
        </div>

        {loading && <p className="px-5 py-6 text-sm text-muted-foreground">Carregando…</p>}
        {!loading && !doc && <p className="px-5 py-6 text-sm text-red-600">Não foi possível carregar a NFS-e.</p>}

        {doc && (
          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="flex items-center gap-2">
              <Badge className={PAPEL_CLASS[doc.papelTitular]}>{PAPEL_LABEL[doc.papelTitular]}</Badge>
              {doc.cancelada ? (
                <Badge className="bg-red-50 text-red-700">Cancelada</Badge>
              ) : (
                <Badge className="bg-emerald-50 text-emerald-700">Ativa</Badge>
              )}
              <button
                onClick={() => void baixarDanfse()}
                disabled={baixando}
                className="ml-auto flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50 transition-colors"
              >
                <FilePdfIcon size={16} /> {baixando ? 'Gerando…' : 'DANFSe'}
              </button>
            </div>
            {danfseErro && <p className="text-xs text-red-600">{danfseErro}</p>}

            <Campo label="Chave de acesso">
              <span className="font-mono text-xs break-all">{fmtChave(doc.chaveAcesso)}</span>
            </Campo>

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
                <Campo label="Retenção ISSQN">
                  {doc.tpRetIssqn === 2 ? 'Retido (tomador)' : doc.tpRetIssqn === 3 ? 'Retido (interm.)' : 'Não retido'}
                </Campo>
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
                <button onClick={() => setShowXml((s) => !s)} className="text-sm font-medium text-primary hover:underline">
                  {showXml ? 'Ocultar XML' : 'Ver XML'}
                </button>
                {showXml && (
                  <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-[11px] leading-tight">
                    {doc.xml}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── Página ───────────────────────────── */

export default function DocumentosNfsePage() {
  const { toasts, error: toastError, dismiss } = useToast();
  const { empresa } = useEmpresaSelecionada();

  const [docs, setDocs] = useState<NfseDoc[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VAZIOS);
  const [filtrosAplicados, setFiltrosAplicados] = useState<Filtros>(FILTROS_VAZIOS);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [detalheId, setDetalheId] = useState<string | null>(null);

  useEffect(() => {
    if (empresa?.cnpj && !filtros.cnpj) {
      setFiltros((f) => ({ ...f, cnpj: empresa.cnpj }));
      setFiltrosAplicados((f) => ({ ...f, cnpj: empresa.cnpj }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa?.cnpj]);

  useEffect(() => {
    api
      .get('/empresas?limit=100')
      .then((res) => setEmpresas(((res.data?.data ?? res.data ?? []) as Empresa[]).filter((e) => e.cnpj)))
      .catch(() => {});
  }, []);

  const carregarDocs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      const f = filtrosAplicados;
      if (f.cnpj) params.set('cnpj', f.cnpj.replace(/\D/g, ''));
      if (f.papel) params.set('papel', f.papel);
      if (f.chaveAcesso) params.set('chaveAcesso', f.chaveAcesso);
      if (f.competenciaInicio) params.set('competenciaInicio', f.competenciaInicio);
      if (f.competenciaFim) params.set('competenciaFim', f.competenciaFim);
      if (f.cancelada) params.set('cancelada', f.cancelada);
      const res = await api.get(`/nfse/documentos?${params.toString()}`);
      setDocs((res.data?.itens ?? []) as NfseDoc[]);
      setTotal((res.data?.total ?? 0) as number);
    } catch {
      toastError('Erro ao carregar NFS-e recebidas');
    } finally {
      setLoading(false);
    }
  }, [page, filtrosAplicados, toastError]);

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

  const totalPaginas = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0 h-full overflow-y-auto pb-4">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-semibold">NFS-e recebidas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Documentos fiscais de serviço distribuídos pelo Ambiente de Dados Nacional (ADN)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void carregarDocs()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50 transition-colors"
          >
            <ArrowClockwiseIcon size={16} /> Atualizar
          </button>
          <Link
            href="/nfse"
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            <GearIcon size={16} /> Configurações
          </Link>
        </div>
      </div>

      <FiltersBar
        filtros={filtros}
        setFiltros={setFiltros}
        empresas={empresas}
        onAplicar={aplicarFiltros}
        onLimpar={limparFiltros}
      />

      <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden flex flex-col min-h-0">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border text-sm">
          <span className="font-medium">
            {total.toLocaleString('pt-BR')} NFS-e{total === 1 ? '' : 's'}
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Papel</TableHead>
                <TableHead>Nº</TableHead>
                <TableHead>Chave</TableHead>
                <TableHead>Prestador</TableHead>
                <TableHead>Tomador</TableHead>
                <TableHead>Competência</TableHead>
                <TableHead>Serviço</TableHead>
                <TableHead className="text-right">ISSQN</TableHead>
                <TableHead className="text-right">Líquido</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-8">
                    Carregando…
                  </TableCell>
                </TableRow>
              ) : docs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-8">
                    Nenhuma NFS-e recebida com os filtros atuais.
                  </TableCell>
                </TableRow>
              ) : (
                docs.map((d) => (
                  <TableRow key={d.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => setDetalheId(d.id)}>
                    <TableCell>
                      <Badge className={PAPEL_CLASS[d.papelTitular]}>{PAPEL_LABEL[d.papelTitular]}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{d.numero ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">…{d.chaveAcesso.slice(-12)}</TableCell>
                    <TableCell className="max-w-[180px] truncate" title={d.prestadorNome ?? ''}>
                      {d.prestadorNome ?? maskCnpj(d.prestadorDoc)}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate" title={d.tomadorNome ?? ''}>
                      {d.tomadorNome ?? maskCnpj(d.tomadorDoc)}
                    </TableCell>
                    <TableCell>{fmtCompet(d.competencia)}</TableCell>
                    <TableCell className="max-w-[160px] truncate" title={d.descricaoServico ?? ''}>
                      {d.codTribNac ? `${d.codTribNac} ` : ''}
                      {d.descricaoServico ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(d.valorIssqn)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(d.valorLiquido)}</TableCell>
                    <TableCell>
                      {d.cancelada ? (
                        <Badge className="bg-red-50 text-red-700">
                          <ProhibitIcon size={12} className="mr-1" /> Cancelada
                        </Badge>
                      ) : (
                        <Badge className="bg-emerald-50 text-emerald-700">
                          <CheckCircleIcon size={12} className="mr-1" /> Ativa
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <CaretRightIcon size={16} className="text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-border text-sm">
          <span className="text-muted-foreground">Página {page} de {totalPaginas}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="rounded-md border px-3 py-1 hover:bg-muted disabled:opacity-50">
              Anterior
            </button>
            <button onClick={() => setPage((p) => Math.min(totalPaginas, p + 1))} disabled={page >= totalPaginas || loading} className="rounded-md border px-3 py-1 hover:bg-muted disabled:opacity-50">
              Próxima
            </button>
          </div>
        </div>
      </div>

      {detalheId && <DetalheDrawer docId={detalheId} onClose={() => setDetalheId(null)} />}
    </div>
  );
}
