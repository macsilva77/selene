'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { ArrowsClockwiseIcon, CheckCircleIcon, WarningCircleIcon, ClockIcon } from '@phosphor-icons/react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast, ToastContainer } from '@/components/ui/toast';
import {
  clientesFornecedoresApi,
  type StatusProcessamentoEmpresa,
} from '@/lib/clientes-fornecedores-api';

function formatarCnpj(cnpj: string) {
  if (cnpj.length === 14)
    return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return cnpj;
}

function formatarData(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function StatusBadge({ pendentes, processadas, total }: { pendentes: number; processadas: number; total: number }) {
  if (pendentes === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        <CheckCircleIcon size={12} />
        Completo
      </span>
    );
  }
  if (processadas === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
        <WarningCircleIcon size={12} />
        Não processado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
      <ClockIcon size={12} />
      Parcial ({processadas}/{total})
    </span>
  );
}

export function ProcessamentoPanel() {
  const { success: toastSuccess, error: toastError, toasts, dismiss } = useToast();

  const [status, setStatus]           = useState<StatusProcessamentoEmpresa[]>([]);
  const [carregando, setCarregando]   = useState(false);
  const [processando, setProcessando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const data = await clientesFornecedoresApi.statusProcessamento();
      setStatus(data);
    } catch {
      toastError('Erro ao carregar status de processamento');
    } finally {
      setCarregando(false);
    }
  }, [toastError]);

  useEffect(() => { void carregar(); }, [carregar]);

  const processarTodas = useCallback(async () => {
    if (processando) return;
    setProcessando(true);
    try {
      const res = await clientesFornecedoresApi.reprocessar();
      toastSuccess(`${res.mensagem} — aguarde o processamento em background`);
      setTimeout(() => void carregar(), 8_000);
      setTimeout(() => void carregar(), 30_000);
    } catch {
      toastError('Erro ao iniciar processamento');
    } finally {
      setProcessando(false);
    }
  }, [processando, carregar, toastSuccess, toastError]);

  const totalEmpresas   = status.length;
  const completas       = status.filter(s => s.pendentes === 0).length;
  const pendentesTotal  = status.reduce((acc, s) => acc + s.pendentes, 0);

  return (
    <>
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      <div className="space-y-4">
        {/* Cabeçalho + botão */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Processamento de Clientes e Fornecedores</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Gera os dados de análise ABC a partir dos arquivos EFD ICMS/IPI carregados.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void carregar()}
              disabled={carregando}
              className="flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50 transition-colors"
            >
              <ArrowsClockwiseIcon size={13} className={carregando ? 'animate-spin' : ''} />
              Atualizar
            </button>
            <button
              type="button"
              onClick={() => void processarTodas()}
              disabled={processando || pendentesTotal === 0}
              className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <ArrowsClockwiseIcon size={13} className={processando ? 'animate-spin' : ''} />
              {processando ? 'Processando…' : `Processar Todas${pendentesTotal > 0 ? ` (${pendentesTotal} pendentes)` : ''}`}
            </button>
          </div>
        </div>

        {/* Resumo */}
        {!carregando && status.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Empresas', valor: totalEmpresas, cor: 'text-foreground' },
              { label: 'Completas', valor: completas, cor: 'text-emerald-600 dark:text-emerald-400' },
              { label: 'Com pendências', valor: totalEmpresas - completas, cor: pendentesTotal > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground' },
            ].map(({ label, valor, cor }) => (
              <Card key={label} className="border">
                <CardContent className="p-3 text-center">
                  <p className={`text-2xl font-bold ${cor}`}>{valor}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Tabela */}
        <Card className="border">
          <CardContent className="p-0">
            {carregando ? (
              <div className="flex flex-col gap-2 p-4">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : status.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Nenhuma empresa com arquivos EFD ICMS/IPI disponíveis.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                      <th className="px-4 py-3 text-left font-medium">Empresa</th>
                      <th className="px-4 py-3 text-left font-medium">CNPJ</th>
                      <th className="px-4 py-3 text-center font-medium">Disponíveis</th>
                      <th className="px-4 py-3 text-center font-medium">Processadas</th>
                      <th className="px-4 py-3 text-center font-medium">Pendentes</th>
                      <th className="px-4 py-3 text-center font-medium">Status</th>
                      <th className="px-4 py-3 text-left font-medium">Última atualização</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.map((s, i) => (
                      <tr key={s.cnpj} className={`border-b border-border last:border-0 ${i % 2 === 0 ? '' : 'bg-muted/20'}`}>
                        <td className="px-4 py-3 font-medium text-foreground">{s.razaoSocial}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{formatarCnpj(s.cnpj)}</td>
                        <td className="px-4 py-3 text-center tabular-nums">{s.totalDisponivel}</td>
                        <td className="px-4 py-3 text-center tabular-nums text-emerald-600 dark:text-emerald-400">{s.processadas}</td>
                        <td className="px-4 py-3 text-center tabular-nums">{s.pendentes > 0 ? <span className="font-semibold text-amber-600 dark:text-amber-400">{s.pendentes}</span> : '—'}</td>
                        <td className="px-4 py-3 text-center">
                          <StatusBadge pendentes={s.pendentes} processadas={s.processadas} total={s.totalDisponivel} />
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{formatarData(s.ultimaAtualizacao)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
