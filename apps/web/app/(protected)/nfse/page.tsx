'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowClockwiseIcon,
  PlusIcon,
  XIcon,
  PlayIcon,
  FileTextIcon,
  WifiHighIcon,
  WifiSlashIcon,
  SealCheckIcon,
  CheckCircleIcon,
  ClockIcon,
  WarningIcon,
  ArrowsClockwiseIcon,
} from '@phosphor-icons/react';
import { api } from '@/lib/api';
import { useToast, ToastContainer } from '@/components/ui/toast';
import { mesmoCnpj } from '@/lib/empresa-selecionada';
import { DataTable } from '@/components/ui/table';

/* ───────────────────────────── Types ───────────────────────────── */

interface NfseControle {
  ultimoNsu: string;
  ultimaConsulta: string | null;
  proximaConsulta: string | null;
  emProcessamento: boolean;
  totalDocBaixados: number;
  totalCiclos: number;
  totalErros: number;
  errosConsecutivos: number;
  ultimoErro: string | null;
}
interface NfseConfig {
  id: string;
  cnpj: string;
  tpAmb: number;
  baseUrl: string;
  certificadoId: string;
  ativo: boolean;
  intervaloMinutos: number;
  controle: NfseControle | null;
}
interface Empresa {
  id: string;
  cnpj: string;
  nome: string;
  nomeFantasia?: string;
}
interface Certificado {
  id: string;
  cnpj: string;
  razaoSocial: string;
  validade: string;
  status: string;
}

/** Linha da tabela = config + dados cruzados da empresa e do certificado. */
interface ConfigRow extends NfseConfig {
  empresaNome?: string;
  certNome?: string;
  certValidade?: string;
}

/* ───────────────────────────── Helpers ───────────────────────────── */

function maskCnpj(v: string | null): string {
  const d = (v ?? '').replace(/\D/g, '');
  if (d.length !== 14) return v ?? '—';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}
function fmtDateTime(iso?: string | null): string {
  if (!iso) return 'Nunca';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? 'Nunca'
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function razaoSemCnpj(s?: string): string {
  return (s ?? '').replace(/:?\d{14}$/, '').trim();
}

/** Deriva o "último retorno" a partir do estado do controle (sem cStat próprio). */
function ultimoRetorno(c: NfseControle | null): { label: string; cls: string } {
  if (!c || (!c.ultimaConsulta && (c.totalDocBaixados ?? 0) === 0)) {
    return { label: 'Aguardando 1ª sincronização', cls: 'bg-slate-100 text-slate-600' };
  }
  if (c.ultimoErro && c.errosConsecutivos > 0) {
    return { label: c.ultimoErro.slice(0, 60), cls: 'bg-red-50 text-red-700' };
  }
  if (c.proximaConsulta && new Date(c.proximaConsulta).getTime() > Date.now()) {
    return { label: 'Atualizado (sem novos)', cls: 'bg-emerald-50 text-emerald-700' };
  }
  if ((c.totalDocBaixados ?? 0) > 0) {
    return { label: 'Documentos localizados', cls: 'bg-emerald-50 text-emerald-700' };
  }
  return { label: 'Sem documentos', cls: 'bg-slate-100 text-slate-600' };
}

/* ───────────────────────────── Modal de configuração ───────────────────────────── */

function ConfigModal({
  empresas,
  certificados,
  onClose,
  onSaved,
}: Readonly<{
  empresas: Empresa[];
  certificados: Certificado[];
  onClose: () => void;
  onSaved: () => void;
}>) {
  const primeira = empresas[0];
  const certDaPrimeira = certificados.find((c) => mesmoCnpj(c.cnpj, primeira?.cnpj));
  const [cnpj, setCnpj] = useState(primeira?.cnpj ?? '');
  const [tpAmb, setTpAmb] = useState<1 | 2>(2);
  const [certificadoId, setCertificadoId] = useState(certDaPrimeira?.id ?? certificados[0]?.id ?? '');
  const [intervaloMinutos, setIntervalo] = useState(60);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const onCnpjChange = (novo: string) => {
    setCnpj(novo);
    const cert = certificados.find((c) => mesmoCnpj(c.cnpj, novo));
    if (cert) setCertificadoId(cert.id);
  };

  const salvar = async () => {
    setErro(null);
    setSaving(true);
    try {
      await api.post('/nfse/configurar', { cnpj, tpAmb, certificadoId, intervaloMinutos });
      onSaved();
      onClose();
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Erro ao salvar configuração';
      setErro(Array.isArray(msg) ? msg.join(', ') : String(msg));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold">Configurar recepção NFS-e</h2>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted">
            <XIcon size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-3 px-5 py-4">
          {empresas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma empresa cadastrada.{' '}
              <a href="/empresas" className="text-primary underline">Cadastre uma empresa</a> primeiro.
            </p>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Empresa (CNPJ)
                <select
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                  value={cnpj}
                  onChange={(e) => onCnpjChange(e.target.value)}
                >
                  {empresas.map((emp) => (
                    <option key={emp.id} value={emp.cnpj}>
                      {maskCnpj(emp.cnpj)} — {emp.nome}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Certificado A1
                <select
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                  value={certificadoId}
                  onChange={(e) => setCertificadoId(e.target.value)}
                >
                  <option value="">Selecione…</option>
                  {certificados.map((c) => (
                    <option key={c.id} value={c.id}>
                      {razaoSemCnpj(c.razaoSocial) || maskCnpj(c.cnpj)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Ambiente
                  <select
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                    value={tpAmb}
                    onChange={(e) => setTpAmb(Number(e.target.value) as 1 | 2)}
                  >
                    <option value={2}>Produção restrita (testes)</option>
                    <option value={1}>Produção</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Intervalo (min)
                  <input
                    type="number"
                    min={60}
                    max={1440}
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                    value={intervaloMinutos}
                    onChange={(e) => setIntervalo(Number(e.target.value))}
                  />
                </label>
              </div>

              {erro && <p className="text-sm text-red-600">{erro}</p>}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button onClick={onClose} className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted">
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={saving || !cnpj || !certificadoId}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── Página ───────────────────────────── */

function InfoItem({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{children}</span>
    </div>
  );
}

function DetalheConfigPopup({
  row,
  sincronizando,
  onClose,
  onSincronizar,
  onToggleAtivo,
}: Readonly<{
  row: ConfigRow;
  sincronizando: boolean;
  onClose: () => void;
  onSincronizar: () => void;
  onToggleAtivo: () => void;
}>) {
  const c = row.controle;
  const ret = ultimoRetorno(c);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[85vh] rounded-xl border border-border bg-card shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              {row.ativo ? <WifiHighIcon size={16} className="text-primary" weight="fill" /> : <WifiSlashIcon size={16} className="text-muted-foreground" weight="fill" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-foreground">{row.empresaNome ?? maskCnpj(row.cnpj)}</h2>
                {row.ativo ? (
                  <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">Ativo</span>
                ) : (
                  <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">Inativo</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">{maskCnpj(row.cnpj)}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-muted"><XIcon size={18} /></button>
        </div>

        <div className="overflow-auto px-6 py-4 flex flex-col gap-5">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Configuração</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <InfoItem label="Ambiente">
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${row.tpAmb === 1 ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'}`}>
                  {row.tpAmb === 1 ? 'Produção' : 'Produção restrita'}
                </span>
              </InfoItem>
              <InfoItem label="Cobertura">Nacional (ADN)</InfoItem>
              <InfoItem label="Certificado">{row.certNome ?? '—'}</InfoItem>
              <InfoItem label="Validade do certificado">{fmtDate(row.certValidade)}</InfoItem>
              <InfoItem label="Periodicidade">{row.intervaloMinutos >= 60 ? `${row.intervaloMinutos / 60} h` : `${row.intervaloMinutos} min`}</InfoItem>
              <InfoItem label="URL base"><span className="font-mono text-xs break-all">{row.baseUrl}</span></InfoItem>
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Monitoramento</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <InfoItem label="Documentos baixados"><span className="text-lg font-semibold">{(c?.totalDocBaixados ?? 0).toLocaleString('pt-BR')}</span></InfoItem>
              <InfoItem label="Total de ciclos"><span className="text-lg font-semibold">{(c?.totalCiclos ?? 0).toLocaleString('pt-BR')}</span></InfoItem>
              <InfoItem label="NSU atual"><span className="font-mono">{c ? Number(c.ultimoNsu).toLocaleString('pt-BR') : '—'}</span></InfoItem>
              <InfoItem label="Erros consecutivos">{c?.errosConsecutivos ?? 0}</InfoItem>
              <InfoItem label="Última consulta">{fmtDateTime(c?.ultimaConsulta)}</InfoItem>
              <InfoItem label="Próxima consulta">{fmtDateTime(c?.proximaConsulta)}</InfoItem>
            </div>
            <div className={`mt-3 rounded-md px-3 py-2 text-xs inline-flex items-center ${ret.cls}`}>{ret.label}</div>
            {c?.ultimoErro && <p className="mt-2 text-xs text-red-600 break-words">{c.ultimoErro}</p>}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <button onClick={onToggleAtivo} className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted">{row.ativo ? 'Desativar' : 'Ativar'}</button>
          <button onClick={onSincronizar} disabled={sincronizando} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            <PlayIcon size={14} /> {sincronizando ? 'Sincronizando…' : 'Sincronizar'}
          </button>
          <button onClick={onClose} className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted">Fechar</button>
        </div>
      </div>
    </div>
  );
}

export default function ConfiguracoesNfsePage() {
  const { toasts, success, error: toastError, dismiss } = useToast();

  const [configs, setConfigs] = useState<NfseConfig[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [certificados, setCertificados] = useState<Certificado[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConfig, setShowConfig] = useState(false);
  const [detalheRow, setDetalheRow] = useState<ConfigRow | null>(null);
  const [sincronizando, setSincronizando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, empRes, certRes] = await Promise.all([
        api.get('/nfse/status'),
        api.get('/empresas?limit=100'),
        api.get('/certificados'),
      ]);
      setConfigs(statusRes.data as NfseConfig[]);
      setEmpresas(((empRes.data?.data ?? empRes.data ?? []) as Empresa[]).filter((e) => e.cnpj));
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
      toastError('Erro ao carregar configurações NFS-e');
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const toggleAtivo = async (row: ConfigRow) => {
    try {
      await api.patch(`/nfse/configurar/${row.id}/ativo`, { ativo: !row.ativo });
      await carregar();
      setDetalheRow(null);
    } catch {
      toastError('Falha ao atualizar status da configuração');
    }
  };

  const sincronizar = async (configId: string) => {
    setSincronizando(configId);
    try {
      const res = await api.post(`/nfse/sincronizar/${configId}`);
      const r = res.data as { documentosBaixados?: number; status?: string };
      success(`Sincronização concluída: ${r.documentosBaixados ?? 0} documento(s).`);
      await carregar();
    } catch {
      toastError('Falha ao sincronizar com o ADN');
    } finally {
      setSincronizando(null);
    }
  };

  // Cruza config × empresa × certificado
  const rows: ConfigRow[] = configs.map((c) => {
    const emp = empresas.find((e) => mesmoCnpj(e.cnpj, c.cnpj));
    const cert = certificados.find((x) => x.id === c.certificadoId);
    return {
      ...c,
      empresaNome: emp?.nomeFantasia || emp?.nome,
      certNome: cert ? razaoSemCnpj(cert.razaoSocial) : undefined,
      certValidade: cert?.validade,
    };
  });

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0 h-full overflow-y-auto pb-4">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-semibold">Recepção NFS-e</h1>
          <p className="text-sm text-muted-foreground mt-1">Configurações de distribuição por CNPJ — clique em Sincronizar para puxar do ADN</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/nfse/documentos" className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors">
            <FileTextIcon size={16} /> Ver documentos
          </Link>
          <button onClick={() => void carregar()} disabled={loading} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50 transition-colors">
            <ArrowClockwiseIcon size={16} /> Atualizar
          </button>
          <button onClick={() => setShowConfig(true)} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition">
            <PlusIcon size={16} /> Nova Configuração
          </button>
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="px-5 py-3 border-b border-border text-sm font-medium">
          {configs.length} configuração{configs.length === 1 ? '' : 'ões'}
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          <DataTable<ConfigRow>
            columns={[
              {
                key: 'cnpj',
                header: 'Empresa',
                render: (row) => (
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      {row.ativo ? (
                        <WifiHighIcon size={13} className="text-primary" weight="fill" />
                      ) : (
                        <WifiSlashIcon size={13} className="text-muted-foreground" weight="fill" />
                      )}
                    </div>
                    <div className="flex flex-col leading-tight">
                      {row.empresaNome && (
                        <span className="text-sm font-medium text-foreground truncate max-w-52">{row.empresaNome}</span>
                      )}
                      <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">{maskCnpj(row.cnpj)}</span>
                    </div>
                  </div>
                ),
              },
              {
                key: 'tpAmb',
                header: 'Ambiente',
                render: (row) => (
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${row.tpAmb === 1 ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'}`}>
                    {row.tpAmb === 1 ? 'Produção' : 'Produção restrita'}
                  </span>
                ),
              },
              {
                key: 'cert',
                header: 'Certificado',
                render: (row) =>
                  row.certNome ? (
                    <span className="text-xs font-medium text-foreground flex items-center gap-1">
                      <SealCheckIcon size={11} className="text-emerald-500 shrink-0" />
                      {row.certNome}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  ),
              },
              {
                key: 'venc',
                header: 'Vencimento',
                render: (row) => {
                  if (!row.certValidade) return <span className="text-xs text-muted-foreground">—</span>;
                  const dias = Math.ceil((new Date(row.certValidade).getTime() - Date.now()) / 86_400_000);
                  const cls = dias <= 0 ? 'text-red-600 font-semibold' : dias <= 30 ? 'text-amber-600 font-medium' : 'text-muted-foreground';
                  return <span className={`text-xs whitespace-nowrap ${cls}`}>{fmtDate(row.certValidade)}</span>;
                },
              },
              {
                key: 'docs',
                header: 'Documentos',
                render: (row) => (
                  <span className="font-semibold text-foreground">{(row.controle?.totalDocBaixados ?? 0).toLocaleString('pt-BR')}</span>
                ),
              },
              {
                key: 'nsu',
                header: 'NSU',
                render: (row) =>
                  row.controle ? (
                    <span className="text-xs font-mono text-foreground">{Number(row.controle.ultimoNsu).toLocaleString('pt-BR')}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  ),
              },
              {
                key: 'ultConsulta',
                header: 'Última consulta',
                render: (row) => (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                    <ClockIcon size={11} />
                    {fmtDateTime(row.controle?.ultimaConsulta)}
                  </div>
                ),
              },
              {
                key: 'retorno',
                header: 'Último retorno',
                render: (row) => {
                  const r = ultimoRetorno(row.controle);
                  return <span className={`inline-flex items-center text-xs px-1.5 py-0.5 rounded ${r.cls}`}>{r.label}</span>;
                },
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => {
                  if (!row.ativo)
                    return (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />Inativo
                      </span>
                    );
                  if (row.controle?.emProcessamento)
                    return (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
                        <ArrowsClockwiseIcon size={10} className="animate-spin" />Processando
                      </span>
                    );
                  if ((row.controle?.errosConsecutivos ?? 0) >= 3)
                    return (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">
                        <WarningIcon size={10} />Erro
                      </span>
                    );
                  return (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">
                      <CheckCircleIcon size={10} />Ativo
                    </span>
                  );
                },
              },
              {
                key: 'acoes',
                header: '',
                render: (row) => (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void sincronizar(row.id);
                    }}
                    disabled={sincronizando === row.id}
                    className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50 whitespace-nowrap"
                  >
                    <PlayIcon size={12} /> {sincronizando === row.id ? 'Sincronizando…' : 'Sincronizar'}
                  </button>
                ),
              },
            ]}
            data={rows}
            isLoading={loading}
            keyExtractor={(row) => row.id}
            emptyMessage='Nenhuma configuração NFS-e. Clique em "Nova Configuração" para começar.'
            onRowClick={(row) => setDetalheRow(row)}
          />
        </div>
      </div>

      {showConfig && (
        <ConfigModal
          empresas={empresas}
          certificados={certificados}
          onClose={() => setShowConfig(false)}
          onSaved={() => {
            success('Configuração salva.');
            void carregar();
          }}
        />
      )}

      {detalheRow && (
        <DetalheConfigPopup
          row={detalheRow}
          sincronizando={sincronizando === detalheRow.id}
          onClose={() => setDetalheRow(null)}
          onSincronizar={() => void sincronizar(detalheRow.id)}
          onToggleAtivo={() => void toggleAtivo(detalheRow)}
        />
      )}
    </div>
  );
}
