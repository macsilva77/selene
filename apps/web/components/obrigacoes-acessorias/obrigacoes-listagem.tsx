'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
  ArrowClockwiseIcon,
  UploadSimpleIcon,
  DownloadSimpleIcon,
  WarningIcon,
  CheckCircleIcon,
  ClockIcon,
  ProhibitIcon,
} from '@phosphor-icons/react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast, ToastContainer } from '@/components/ui/toast';
import { UploadObrigacaoModal } from './upload-modal';
import {
  obrigacoesApi,
  formatarCnpj,
  formatarData,
  formatarPeriodo,
  isStatusErro,
  type TipoObrigacao,
  type FinalidadeObrigacao,
  type StatusProcessamento,
  type ObrigacaoAcessoria,
} from '@/lib/obrigacoes-api';

/* ─── Props ──────────────────────────────────────────────────────────────── */
interface Props {
  tipoObrigacao:        TipoObrigacao;
  titulo:               string;
  showInscricaoEstadual: boolean;
}

/* ─── Badge helpers ──────────────────────────────────────────────────────── */
function StatusBadge({ status }: Readonly<{ status: StatusProcessamento }>) {
  if (status === 'Processado') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
        <CheckCircleIcon size={11} />Processado
      </span>
    );
  }
  if (status === 'Recebido') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
        <ClockIcon size={11} />Recebido
      </span>
    );
  }
  // Qualquer Erro_* — RN-17
  const label = status.replace('Erro_', '').replace(/_/g, ' ');
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-destructive/15 text-destructive">
      <WarningIcon size={11} />{label}
    </span>
  );
}

function VersaoBadge({ versaoAtual }: Readonly<{ versaoAtual: boolean }>) {
  if (versaoAtual) {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary">
        Versão Atual
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
      Versão Original
    </span>
  );
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

  // ── Estado dos filtros (sincronizados com URL) ──
  const [cnpj,         setCnpj]         = useState(searchParams.get('cnpj') ?? '');
  const [dataInicial,  setDataInicial]  = useState(searchParams.get('dataInicial') ?? '');
  const [dataFinal,    setDataFinal]    = useState(searchParams.get('dataFinal') ?? '');
  const [status,       setStatus]       = useState<StatusProcessamento | ''>(
    (searchParams.get('status') as StatusProcessamento) ?? '',
  );
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
        statusProcessamento: status    || undefined,
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
  }, [tipoObrigacao, cnpj, dataInicial, dataFinal, status, finalidade, page, toastError]);

  // Carrega na montagem e quando a página muda
  useEffect(() => { void buscar(page); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleFiltrar(e: React.FormEvent) {
    e.preventDefault();
    const pg = 1;
    setPage(pg);
    pushParams({ cnpj, dataInicial, dataFinal, status: status || undefined, finalidade: finalidade || undefined, page: pg });
    void buscar(pg);
  }

  function handleLimpar() {
    setCnpj(''); setDataInicial(''); setDataFinal('');
    setStatus(''); setFinalidade(''); setPage(1);
    router.replace(pathname);
    void buscar(1);
  }

  // ── Download ──
  async function handleDownload(item: ObrigacaoAcessoria) {
    try {
      const { url } = await obrigacoesApi.gerarDownloadUrl(item.id);
      const a = document.createElement('a');
      a.href  = url;
      a.download = item.nomeArquivo;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      toastError('Não foi possível gerar o link de download');
    }
  }

  // ── Paginação ──
  function irPagina(pg: number) {
    setPage(pg);
    pushParams({ page: pg });
  }

  // ── Row style para erros (RN-17) ──
  function rowCls(item: ObrigacaoAcessoria) {
    return isStatusErro(item.statusProcessamento)
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
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">CNPJ</label>
          <input className={`${inputCls} w-44`} placeholder="00.000.000/0000-00"
            value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Data Inicial</label>
          <input type="date" className={`${inputCls} w-36`}
            value={dataInicial} onChange={(e) => setDataInicial(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Data Final</label>
          <input type="date" className={`${inputCls} w-36`}
            value={dataFinal} onChange={(e) => setDataFinal(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Status</label>
          <select className={`${selectCls} w-48`} value={status}
            onChange={(e) => setStatus(e.target.value as StatusProcessamento | '')}>
            <option value="">Todos</option>
            <option value="Recebido">Recebido</option>
            <option value="Processado">Processado</option>
            <option value="Erro_Validacao">Erro: Validação</option>
            <option value="Erro_Arquivo_Nao_Encontrado">Erro: Arquivo</option>
            <option value="Erro_Hash_Divergente">Erro: Hash</option>
            <option value="Erro_Duplicata_Original">Erro: Duplicata</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Finalidade</label>
          <select className={`${selectCls} w-36`} value={finalidade}
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
      </form>

      {/* Contagem */}
      <p className="text-sm text-muted-foreground">
        {carregando ? 'Carregando…' : `${total} registro${total !== 1 ? 's' : ''} encontrado${total !== 1 ? 's' : ''}`}
      </p>

      {/* Tabela */}
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead>CNPJ</TableHead>
              {showInscricaoEstadual && <TableHead>Insc. Estadual</TableHead>}
              <TableHead>Período</TableHead>
              <TableHead>Finalidade</TableHead>
              <TableHead className="text-center">Versão</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Data Entrega</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && !carregando && (
              <TableRow>
                <TableCell
                  colSpan={showInscricaoEstadual ? 9 : 8}
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
                <TableCell className="text-xs whitespace-nowrap">
                  {formatarPeriodo(item.dataInicial, item.dataFinal)}
                </TableCell>
                <TableCell className="text-xs">{item.finalidade}</TableCell>
                <TableCell className="text-center">
                  <VersaoBadge versaoAtual={item.versaoAtual} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={item.statusProcessamento} />
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  {formatarData(item.dataEntrega)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {item.origem === 'Upload_Manual' ? 'Manual' : 'Tópico'}
                </TableCell>
                <TableCell className="text-right">
                  {item.statusProcessamento === 'Processado' && (
                    <button
                      type="button"
                      title="Baixar arquivo"
                      onClick={() => void handleDownload(item)}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs border border-input hover:bg-muted transition-colors">
                      <DownloadSimpleIcon size={13} />
                      Download
                    </button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Página {page} de {totalPages}
          </span>
          <div className="flex gap-1">
            <button type="button" onClick={() => irPagina(page - 1)} disabled={page <= 1}
              className="rounded-md border border-input px-3 py-1.5 hover:bg-muted transition-colors disabled:opacity-40">
              Anterior
            </button>
            <button type="button" onClick={() => irPagina(page + 1)} disabled={page >= totalPages}
              className="rounded-md border border-input px-3 py-1.5 hover:bg-muted transition-colors disabled:opacity-40">
              Próxima
            </button>
          </div>
        </div>
      )}

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
