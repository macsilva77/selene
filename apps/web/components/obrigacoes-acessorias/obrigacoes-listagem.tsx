'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import {
  ArrowClockwiseIcon,
  UploadSimpleIcon,
  DownloadSimpleIcon,
  ProhibitIcon,
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

  // ── Lista de empresas para o select de CNPJ ──
  const [empresas, setEmpresas] = useState<{ id: string; cnpj: string; nome: string; nomeFantasia?: string }[]>([]);

  useEffect(() => {
    api.get('/empresas?limit=200&ativo=true')
      .then((res) => {
        const list = (res.data?.data ?? res.data ?? []) as { id: string; cnpj: string; nome: string; nomeFantasia?: string }[];
        setEmpresas(list.filter((e) => e.cnpj));
      })
      .catch(() => {});
  }, []);

  // ── Estado dos filtros (sincronizados com URL) ──
  const [cnpj,         setCnpj]         = useState(searchParams.get('cnpj') ?? '');
  const [dataInicial,  setDataInicial]  = useState(searchParams.get('dataInicial') ?? '');
  const [dataFinal,    setDataFinal]    = useState(searchParams.get('dataFinal') ?? '');
  const [finalidade,   setFinalidade]   = useState<FinalidadeObrigacao | ''>(
    (searchParams.get('finalidade') as FinalidadeObrigacao) ?? '',
  );
  const [page,         setPage]         = useState(Number(searchParams.get('page') ?? 1));

  // ── Estado de dados ──
  const [items,        setItems]        = useState<ObrigacaoAcessoria[]>([]);
  const [total,        setTotal]        = useState(0);
  const [totalPages,   setTotalPages]   = useState(1);
  const [carregando,   setCarregando]   = useState(false);

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
        cnpj:         cnpj.replace(/\D/g, '') || undefined,
        dataInicial:  dataInicial || undefined,
        dataFinal:    dataFinal   || undefined,
        finalidade:   finalidade  || undefined,
        page:         pg,
        size:         PAGE_SIZE,
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

  // Carrega na montagem e quando a página muda
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

  // ── Download via proxy (sem Signed URL) ──
  async function handleDownload(item: ObrigacaoAcessoria) {
    try {
      await obrigacoesApi.baixarArquivo(item.id, item.nomeArquivo);
    } catch {
      toastError('Não foi possível baixar o arquivo');
    }
  }

  // ── Paginação ──
  function irPagina(pg: number) {
    setPage(pg);
    pushParams({ page: pg });
  }

  // ── Row style para erros (RN-17) ──
  function rowCls(item: ObrigacaoAcessoria) {
    return item.statusProcessamento.startsWith('Erro_')
      ? 'bg-destructive/5 hover:bg-destructive/10'
      : '';
  }

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

      {/* Filtros — query params persistidos na URL */}
      <form onSubmit={handleFiltrar}
        className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3">
        {/* Linha 1: CNPJ em largura total para exibir nome completo */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">CNPJ</label>
          <select
            title="Filtrar por CNPJ"
            className={`${selectCls} w-full`}
            value={cnpj}
            onChange={(e) => setCnpj(e.target.value)}
          >
            <option value="">Todos</option>
            {empresas.map((emp) => {
              const nomeCompleto = emp.nomeFantasia || emp.nome;
              const label = nomeCompleto
                ? nomeCompleto.length > 50
                  ? `${nomeCompleto.slice(0, 50)}…`
                  : nomeCompleto
                : formatarCnpj(emp.cnpj);
              return (
                <option key={emp.id} value={emp.cnpj.replace(/\D/g, '')}>
                  {label}
                </option>
              );
            })}
          </select>
        </div>
        {/* Linha 2: Demais filtros */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Data Inicial</label>
            <input type="date" title="Data inicial" className={`${inputCls} w-36`}
              value={dataInicial} onChange={(e) => setDataInicial(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Data Final</label>
            <input type="date" title="Data final" className={`${inputCls} w-36`}
              value={dataFinal} onChange={(e) => setDataFinal(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Finalidade</label>
            <select title="Filtrar por finalidade" className={`${selectCls} w-36`} value={finalidade}
              onChange={(e) => setFinalidade(e.target.value as FinalidadeObrigacao | '')}>
              <option value="">Todas</option>
              <option value="Original">Original</option>
              <option value="Retificacao">Retificação</option>
            </select>
          </div>
          <div className="flex gap-2 pb-0.5">
            <button type="submit"
              className="h-8 rounded-md bg-primary text-primary-foreground px-3 text-sm hover:bg-primary/90 transition-colors">
              Filtrar
            </button>
            <button type="button" onClick={handleLimpar}
              className="h-8 rounded-md border border-input px-3 text-sm hover:bg-muted transition-colors">
              Limpar
            </button>
          </div>
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
