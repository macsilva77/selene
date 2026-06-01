'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import {
  ArrowClockwiseIcon,
  UploadSimpleIcon,
  DownloadSimpleIcon,
  ProhibitIcon,
  CaretDownIcon,
} from '@phosphor-icons/react';
import { ActionsMenu } from '@/components/ui/actions-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { useToast, ToastContainer } from '@/components/ui/toast';
import { UploadObrigacaoModal } from './upload-modal';
import {
  obrigacoesApi,
  formatarCnpj,
  formatarData,
  type TipoObrigacao,
  type FinalidadeObrigacao,
  type ObrigacaoAcessoria,
} from '@/lib/obrigacoes-api';

/* ─── Props ──────────────────────────────────────────────────────────────── */
interface Props {
  tipoObrigacao:        TipoObrigacao;
  titulo:               string;
  showInscricaoEstadual: boolean;
}

/* ─── Helpers de input ───────────────────────────────────────────────────── */
const inputCls  = 'h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring';
const selectCls = inputCls;
const PAGE_SIZE = 20;

/* ─── Componente principal ───────────────────────────────────────────────── */
export function ObrigacoesListagem({ tipoObrigacao, titulo, showInscricaoEstadual }: Readonly<Props>) {
  const router      = useRouter();
  const pathname    = usePathname();
  const searchParams = useSearchParams();
  const { toasts, success, error: toastError, dismiss } = useToast();

  // ── Lista de empresas para o combobox de CNPJ ──
  const [empresas, setEmpresas] = useState<{ id: string; cnpj: string; nome: string; nomeFantasia?: string }[]>([]);

  useEffect(() => {
    api.get('/empresas?limit=500&ativo=true')
      .then((res) => {
        const list = (res.data?.data ?? res.data ?? []) as { id: string; cnpj: string; nome: string; nomeFantasia?: string }[];
        setEmpresas(list.filter((e) => e.cnpj));
      })
      .catch(() => {});
  }, []);

  // ── Combobox CNPJ ──
  const [cnpjSearch, setCnpjSearch] = useState('');
  const [cnpjOpen,   setCnpjOpen]   = useState(false);
  const cnpjRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cnpjRef.current && !cnpjRef.current.contains(e.target as Node)) {
        setCnpjOpen(false);
        setCnpjSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Estado dos filtros (sincronizados com URL) ──
  const [cnpj,        setCnpj]       = useState(searchParams.get('cnpj') ?? '');
  const [dataInicial, setDataInicial] = useState(searchParams.get('dataInicial') ?? '');
  const [dataFinal,   setDataFinal]   = useState(searchParams.get('dataFinal') ?? '');
  const [finalidade,  setFinalidade]  = useState<FinalidadeObrigacao | ''>(
    (searchParams.get('finalidade') as FinalidadeObrigacao) ?? '',
  );
  const [page, setPage] = useState(Number(searchParams.get('page') ?? 1));

  // ── Estado de dados ──
  const [items,      setItems]      = useState<ObrigacaoAcessoria[]>([]);
  const [total,      setTotal]      = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [carregando, setCarregando] = useState(false);

  // ── Modal de upload ──
  const [uploadAberto, setUploadAberto] = useState(false);

  // ── Atualiza URL com filtros ──
  const pushParams = useCallback((overrides: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(overrides).forEach(([k, v]) => {
      if (v !== undefined && v !== '') params.set(k, String(v));
      else params.delete(k);
    });
    router.replace(`${pathname}?${params.toString()}`);
  }, [router, pathname, searchParams]);

  // ── Busca dados ──
  const buscar = useCallback(async (pg = page) => {
    setCarregando(true);
    try {
      const resp = await obrigacoesApi.listar({
        tipoObrigacao,
        cnpj:        cnpj.replace(/\D/g, '') || undefined,
        dataInicial: dataInicial || undefined,
        dataFinal:   dataFinal   || undefined,
        finalidade:  finalidade  || undefined,
        page:        pg,
        size:        PAGE_SIZE,
      });
      setItems(resp.items);
      setTotal(resp.total);
      setTotalPages(resp.totalPages);
    } catch {
      toastError('Erro ao carregar dados');
    } finally {
      setCarregando(false);
    }
  }, [tipoObrigacao, cnpj, dataInicial, dataFinal, finalidade, page, toastError]);

  useEffect(() => { void buscar(page); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleFiltrar(e: React.FormEvent) {
    e.preventDefault();
    const pg = 1;
    setPage(pg);
    pushParams({ cnpj, dataInicial, dataFinal, finalidade: finalidade || undefined, page: pg });
    void buscar(pg);
  }

  function handleLimpar() {
    setCnpj(''); setDataInicial(''); setDataFinal('');
    setFinalidade(''); setPage(1);
    router.replace(pathname);
    void buscar(1);
  }

  async function handleDownload(item: ObrigacaoAcessoria) {
    try {
      await obrigacoesApi.baixarArquivo(item.id, item.nomeArquivo);
    } catch {
      toastError('Não foi possível baixar o arquivo');
    }
  }

  function irPagina(pg: number) {
    setPage(pg);
    pushParams({ page: pg });
  }

  function rowCls(item: ObrigacaoAcessoria) {
    return item.statusProcessamento.startsWith('Erro_')
      ? 'bg-destructive/5 hover:bg-destructive/10'
      : '';
  }

  // ── Filtro do combobox ──
  const empSel     = cnpj ? empresas.find((e) => e.cnpj.replace(/\D/g, '') === cnpj) : null;
  const nomeSel    = empSel ? (empSel.nomeFantasia || empSel.nome || '') : '';
  const displaySel = empSel ? `${formatarCnpj(empSel.cnpj)} — ${nomeSel}` : '';
  const termo      = cnpjSearch.replace(/[.\-/]/g, '').toLowerCase();
  const empsFiltradas = termo
    ? empresas.filter((e) => {
        const cnpjNorm = e.cnpj.replace(/[.\-/]/g, '').toLowerCase();
        const nome     = (e.nomeFantasia || e.nome || '').toLowerCase();
        return cnpjNorm.includes(termo) || nome.includes(termo);
      })
    : empresas;

  return (
    <div className="space-y-4">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">{titulo}</h1>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void buscar(page)}
            disabled={carregando}
            className="flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted transition-colors disabled:opacity-50">
            <ArrowClockwiseIcon size={15} className={carregando ? 'animate-spin' : ''} />
            Atualizar
          </button>
          <button type="button" onClick={() => setUploadAberto(true)}
            className="flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm hover:bg-primary/90 transition-colors">
            <UploadSimpleIcon size={15} />
            Upload Manual
          </button>
        </div>
      </div>

      {/*
        FILTROS
        ───────
        Card: w-full (100% da tela)
        Grid interno: 5 colunas fixas — 130px | 130px | 160px | auto(Filtrar) | auto(Limpar)
        Linha 1: CNPJ abrange cols 1–4  →  borda direita = borda direita do Filtrar
        Linha 2: Data Inicial | Data Final | Finalidade | Filtrar | Limpar
        Nenhum campo usa flex:1
      */}
      <form onSubmit={handleFiltrar}
        className="w-full rounded-lg border border-border bg-card px-4 py-3">
        <div
          className="inline-grid gap-[10px] grid-cols-[130px_130px_160px_auto_auto]"
        >
          {/* ── Linha 1: CNPJ / Razão Social (cols 1–4) ── */}
          <div className="flex flex-col gap-1 col-span-4" ref={cnpjRef}>
            <label className="text-xs text-muted-foreground">CNPJ / Razão Social</label>
            <div className="relative">
              <input
                type="text"
                autoComplete="off"
                placeholder="Todos — pesquise por CNPJ ou razão social"
                className={`${inputCls} w-full pr-7`}
                value={cnpjOpen ? cnpjSearch : displaySel}
                onChange={(e) => { setCnpjSearch(e.target.value); setCnpjOpen(true); }}
                onFocus={() => { setCnpjSearch(''); setCnpjOpen(true); }}
              />
              <CaretDownIcon size={13}
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              {cnpjOpen && (
                <div className="absolute left-0 top-full mt-1 z-50 w-full min-w-[420px] rounded-md border border-input bg-background shadow-lg max-h-64 overflow-y-auto">
                  <button type="button"
                    className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors border-b border-input/30"
                    onClick={() => { setCnpj(''); setCnpjSearch(''); setCnpjOpen(false); }}>
                    Todos
                  </button>
                  {empsFiltradas.length === 0 && (
                    <p className="px-3 py-2 text-sm text-muted-foreground">Nenhuma empresa encontrada</p>
                  )}
                  {empsFiltradas.map((emp) => {
                    const nome = emp.nomeFantasia || emp.nome;
                    return (
                      <button type="button" key={emp.id}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-baseline gap-2 ${cnpj === emp.cnpj.replace(/\D/g, '') ? 'bg-primary/5 font-medium' : ''}`}
                        onClick={() => { setCnpj(emp.cnpj.replace(/\D/g, '')); setCnpjSearch(''); setCnpjOpen(false); }}>
                        <span className="font-mono text-xs text-muted-foreground shrink-0">{formatarCnpj(emp.cnpj)}</span>
                        {nome && <span className="text-foreground truncate">{nome}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          {/* col 5 da linha 1: ghost invisível do Limpar — alinha borda direita */}
          <div aria-hidden="true" className="invisible pointer-events-none self-end">
            <button type="button" tabIndex={-1}
              className="h-8 rounded-md border border-input px-3 text-sm">Limpar</button>
          </div>

          {/* ── Linha 2: campos + botões (cada um em sua coluna) ── */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Data Inicial</label>
            <input type="date" title="Data inicial" className={`${inputCls} w-full`}
              value={dataInicial} onChange={(e) => setDataInicial(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Data Final</label>
            <input type="date" title="Data final" className={`${inputCls} w-full`}
              value={dataFinal} onChange={(e) => setDataFinal(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Finalidade</label>
            <select title="Filtrar por finalidade" className={`${selectCls} w-full`} value={finalidade}
              onChange={(e) => setFinalidade(e.target.value as FinalidadeObrigacao | '')}>
              <option value="">Todas</option>
              <option value="Original">Original</option>
              <option value="Retificacao">Retificação</option>
            </select>
          </div>
          <button type="submit" className="self-end h-8 rounded-md bg-primary text-primary-foreground px-3 text-sm hover:bg-primary/90 transition-colors">
            Filtrar
          </button>
          <button type="button" onClick={handleLimpar} className="self-end h-8 rounded-md border border-input px-3 text-sm hover:bg-muted transition-colors">
            Limpar
          </button>
        </div>
      </form>

      {/* Contagem */}
      <p className="text-sm text-muted-foreground">
        {carregando ? 'Carregando…' : `${total} registro${total !== 1 ? 's' : ''} encontrado${total !== 1 ? 's' : ''}`}
      </p>

      {/* Tabela */}
      <div className="rounded-lg border border-border overflow-hidden">
        <Table className="table-fixed w-full">
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="w-[13%]">CNPJ</TableHead>
              {showInscricaoEstadual && <TableHead className="w-[9%]">Insc. Estadual</TableHead>}
              <TableHead className="w-[8%]">Finalidade</TableHead>
              <TableHead className="w-[20%]">Hash</TableHead>
              <TableHead className="w-[10%]">Data Início</TableHead>
              <TableHead className="w-[10%]">Data Fim</TableHead>
              <TableHead className="w-[12%]">Data Envio SPED</TableHead>
              <TableHead className="w-[5%] text-center">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && !carregando && (
              <TableRow>
                <TableCell
                  colSpan={showInscricaoEstadual ? 8 : 7}
                  className="text-center py-10 text-sm text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <ProhibitIcon size={24} className="text-muted-foreground/40" />
                    Nenhum registro encontrado
                  </div>
                </TableCell>
              </TableRow>
            )}
            {items.map((item) => (
              <TableRow key={item.id} className={rowCls(item)}>
                <TableCell className="font-mono text-xs">{formatarCnpj(item.cnpj)}</TableCell>
                {showInscricaoEstadual && (
                  <TableCell className="text-xs">{item.inscricaoEstadual ?? '—'}</TableCell>
                )}
                <TableCell className="text-xs">{item.finalidade}</TableCell>
                <TableCell className="overflow-hidden" title={item.hash}>
                  <span className="block truncate font-mono text-xs text-muted-foreground">{item.hash}</span>
                </TableCell>
                <TableCell className="text-xs">{formatarData(item.dataInicial)}</TableCell>
                <TableCell className="text-xs">{formatarData(item.dataFinal)}</TableCell>
                <TableCell className="text-xs">{formatarData(item.dataEntrega)}</TableCell>
                <TableCell className="text-center">
                  <ActionsMenu
                    actions={[
                      {
                        label: 'Download',
                        icon: <DownloadSimpleIcon size={14} />,
                        onClick: () => void handleDownload(item),
                        hidden: item.statusProcessamento !== 'Processado',
                      },
                    ]}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Paginação */}
      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        limit={PAGE_SIZE}
        onPageChange={irPagina}
      />

      {/* Modal de upload */}
      <UploadObrigacaoModal
        isOpen={uploadAberto}
        onClose={() => setUploadAberto(false)}
        tipoInicial={tipoObrigacao}
        onSuccess={(id) => {
          setUploadAberto(false);
          success(`Arquivo enviado com sucesso. ID: ${id}`);
          void buscar(1);
        }}
      />
    </div>
  );
}
