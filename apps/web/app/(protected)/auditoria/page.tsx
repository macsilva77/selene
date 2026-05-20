'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowClockwise, X } from '@phosphor-icons/react';
import { DataTable } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { Modal } from '@/components/ui/modal';
import { useToast, ToastContainer } from '@/components/ui/toast';
import { api } from '@/lib/api';

const PAGE_SIZE = 50;

type AuditAcao =
  | 'CREATE' | 'UPDATE' | 'STATUS_CHANGE' | 'UPLOAD'
  | 'INATIVAR' | 'LOGIN' | 'LOGOUT' | 'NOTIFICACAO_DISPARADA' | 'LOGIN_FALHO' | 'USO';

interface AuditLog {
  id: string;
  criadoEm: string;
  usuarioId: string | null;
  acao: AuditAcao;
  entidadeTipo: string;
  entidadeId: string;
  ipOrigem: string | null;
  correlationId?: string | null;
  payloadAntes: Record<string, unknown> | null;
  payloadDepois: Record<string, unknown> | null;
}

interface UsuarioResumo {
  id: string;
  nome: string;
}

const ACOES: { value: AuditAcao | ''; label: string }[] = [
  { value: '', label: 'Todas as ações' },
  { value: 'CREATE', label: 'Criação' },
  { value: 'UPDATE', label: 'Atualização' },
  { value: 'STATUS_CHANGE', label: 'Mudança de status' },
  { value: 'UPLOAD', label: 'Upload' },
  { value: 'INATIVAR', label: 'Inativação' },
  { value: 'LOGIN', label: 'Login' },
  { value: 'LOGOUT', label: 'Logout' },
  { value: 'NOTIFICACAO_DISPARADA', label: 'Notificação disparada' },
  { value: 'LOGIN_FALHO', label: 'Login falho' },
  { value: 'USO', label: 'Uso de certificado' },
];

const ENTIDADE_TIPOS = [
  '', 'Usuario', 'Tenant', 'Fornecedor', 'Empresa', 'CertificadoDigital',
  'Etiqueta', 'DfeDocumentoEtiqueta',
];

const ENTIDADE_LABEL: Record<string, string> = {
  Tenant:               'Organização',
  CertificadoDigital:   'Certificado Digital',
  Etiqueta:             'Etiqueta',
  DfeDocumentoEtiqueta: 'Associação de Etiqueta',
};

function entidadeLabel(tipo: string): string {
  return ENTIDADE_LABEL[tipo] ?? tipo;
}

const ACAO_BADGE: Record<AuditAcao, { cls: string; label: string }> = {
  CREATE:                { cls: 'bg-emerald-100 text-emerald-700 border border-emerald-200',  label: 'Criação' },
  UPDATE:                { cls: 'bg-violet-100 text-violet-700 border border-violet-200',      label: 'Atualização' },
  STATUS_CHANGE:         { cls: 'bg-amber-100 text-amber-700 border border-amber-200',         label: 'Status' },
  UPLOAD:                { cls: 'bg-sky-100 text-sky-700 border border-sky-200',               label: 'Upload' },
  INATIVAR:              { cls: 'bg-orange-100 text-orange-700 border border-orange-200',      label: 'Inativação' },
  LOGIN:                 { cls: 'bg-transparent text-muted-foreground border border-border',   label: 'Login' },
  LOGOUT:                { cls: 'bg-transparent text-muted-foreground border border-border',   label: 'Logout' },
  NOTIFICACAO_DISPARADA: { cls: 'bg-primary/10 text-primary border border-primary/20',         label: 'Notificação' },
  LOGIN_FALHO:           { cls: 'bg-red-100 text-red-700 border border-red-200',               label: 'Login falho' },
  USO:                   { cls: 'bg-cyan-100 text-cyan-700 border border-cyan-200',             label: 'Uso de certificado' },
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function PayloadPanel({ title, payload, highlight }: { title: string; payload: Record<string, unknown> | null; highlight?: 'before' | 'after' }) {
  const headerCls = highlight === 'before'
    ? 'bg-amber-50 border-amber-200 text-amber-700'
    : 'bg-emerald-50 border-emerald-200 text-emerald-700';
  const contentCls = highlight === 'before'
    ? 'border-amber-200 bg-amber-50/40 text-foreground'
    : 'border-emerald-200 bg-emerald-50/40 text-foreground';

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg border border-b-0 ${headerCls}`}>
        <span className={`inline-block w-2 h-2 rounded-full ${highlight === 'before' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
        <span className="text-xs font-semibold uppercase tracking-wide">{title}</span>
      </div>
      {payload ? (
        <pre className={`rounded-b-lg border p-3 text-xs overflow-auto max-h-64 whitespace-pre-wrap break-words font-mono flex-1 ${contentCls}`}>
          {JSON.stringify(payload, null, 2)}
        </pre>
      ) : (
        <div className="rounded-b-lg border border-input bg-muted p-4 text-xs text-muted-foreground italic text-center flex-1 flex items-center justify-center min-h-[60px]">
          Sem dados
        </div>
      )}
    </div>
  );
}

function MetaField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

function DetalheModal({ log, onClose, nomeUsuario }: { log: AuditLog; onClose: () => void; nomeUsuario: (id: string | null) => string }) {
  const badge = ACAO_BADGE[log.acao];
  const temPayload = log.payloadAntes !== null || log.payloadDepois !== null;

  return (
    <Modal isOpen onClose={onClose} title="Detalhes do Registro" size="3xl">
      {/* Metadata grid */}
      <div className="grid grid-cols-3 gap-x-6 gap-y-4 p-4 rounded-lg bg-muted border border-border mb-5">
        <MetaField label="Data/Hora">{formatDateTime(log.criadoEm)}</MetaField>
        <MetaField label="Usuário">{nomeUsuario(log.usuarioId)}</MetaField>
        <MetaField label="IP Origem"><span className="text-muted-foreground">{log.ipOrigem ?? '—'}</span></MetaField>
        <MetaField label="Ação">
          {badge
            ? <span className={`inline-flex px-2.5 py-0.5 text-xs font-semibold rounded-full ${badge.cls}`}>{badge.label}</span>
            : <span className="inline-flex px-2.5 py-0.5 text-xs font-semibold rounded-full bg-muted text-muted-foreground">{log.acao}</span>
          }
        </MetaField>
        <MetaField label="Entidade">{entidadeLabel(log.entidadeTipo)}</MetaField>
        <MetaField label="ID da Entidade">
          <span className="font-mono text-xs text-muted-foreground break-all">{log.entidadeId}</span>
        </MetaField>
        {log.correlationId && (
          <div className="col-span-3">
            <MetaField label="Correlation ID">
              <span className="font-mono text-xs text-muted-foreground">{log.correlationId}</span>
            </MetaField>
          </div>
        )}
      </div>

      {/* Payload */}
      {temPayload ? (
        <>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Valores alterados</span>
            <div className="flex-1 border-t border-border" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <PayloadPanel title="Antes" payload={log.payloadAntes} highlight="before" />
            <PayloadPanel title="Depois" payload={log.payloadDepois} highlight="after" />
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-border bg-muted p-4 text-xs text-muted-foreground italic text-center">
          Esta operação não registrou payload de dados.
        </div>
      )}
    </Modal>
  );
}

export default function AuditoriaPage() {
  const { toasts, error: toastError, dismiss } = useToast();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [metaTotal, setMetaTotal] = useState(0);
  const [metaTotalPages, setMetaTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [usuarios, setUsuarios] = useState<UsuarioResumo[]>([]);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const [page, setPage] = useState(1);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [entidadeTipo, setEntidadeTipo] = useState('');
  const [acao, setAcao] = useState<AuditAcao | ''>('');
  const [usuarioId, setUsuarioId] = useState('');

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.get('/auth/usuarios?limit=200')
      .then((res) => {
        const d = res.data;
        setUsuarios(d.data ?? d ?? []);
      })
      .catch(() => {/* silently ignore */});
  }, []);

  const nomeUsuario = useCallback((id: string | null) => {
    if (!id) return '—';
    return usuarios.find((u) => u.id === id)?.nome ?? id.slice(0, 8) + '…';
  }, [usuarios]);

  const fetchLogs = useCallback(async (p: number) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
      if (dataInicio) params.set('dataInicio', dataInicio);
      if (dataFim) params.set('dataFim', dataFim + 'T23:59:59');
      if (entidadeTipo) params.set('entidadeTipo', entidadeTipo);
      if (acao) params.set('acao', acao);
      if (usuarioId) params.set('usuarioId', usuarioId);
      const res = await api.get(`/auditoria?${params}`);
      const d = res.data;
      setLogs(d.data ?? []);
      setMetaTotal(d.total ?? d.meta?.total ?? 0);
      setMetaTotalPages(d.totalPages ?? d.meta?.totalPages ?? 1);
    } catch {
      toastError('Erro ao carregar logs de auditoria.');
    } finally {
      setIsLoading(false);
    }
  }, [dataInicio, dataFim, entidadeTipo, acao, usuarioId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      void fetchLogs(1);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [dataInicio, dataFim, entidadeTipo, acao, usuarioId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void fetchLogs(page); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const limparFiltros = () => {
    setDataInicio('');
    setDataFim('');
    setEntidadeTipo('');
    setAcao('');
    setUsuarioId('');
  };

  const temFiltro = dataInicio || dataFim || entidadeTipo || acao || usuarioId;

  const columns = [
    {
      key: 'criadoEm',
      header: 'Data/Hora',
      render: (log: AuditLog) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(log.criadoEm)}</span>
      ),
    },
    {
      key: 'usuario',
      header: 'Usuário',
      render: (log: AuditLog) => (
        <span className="text-sm text-foreground">{nomeUsuario(log.usuarioId)}</span>
      ),
    },
    {
      key: 'acao',
      header: 'Ação',
      render: (log: AuditLog) => {
        const badge = ACAO_BADGE[log.acao];
        return badge
          ? <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${badge.cls}`}>{badge.label}</span>
          : <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-muted text-muted-foreground">{log.acao}</span>;
      },
    },
    {
      key: 'entidadeTipo',
      header: 'Entidade',
      render: (log: AuditLog) => (
        <span className="text-sm text-foreground">{entidadeLabel(log.entidadeTipo)}</span>
      ),
    },
    {
      key: 'entidadeId',
      header: 'ID',
      render: (log: AuditLog) => (
        <span className="font-mono text-xs text-muted-foreground" title={log.entidadeId}>
          {log.entidadeId.length > 12 ? log.entidadeId.slice(0, 8) + '…' : log.entidadeId}
        </span>
      ),
    },
    {
      key: 'payload',
      header: 'Dados',
      render: (log: AuditLog) => {
        const temDados = log.payloadAntes !== null || log.payloadDepois !== null;
        return temDados
          ? <span className="text-xs text-primary font-medium">Ver detalhes →</span>
          : <span className="text-xs text-muted-foreground">—</span>;
      },
    },
  ];

  const selectClass =
    'rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors';

  return (
    <div className="flex flex-col gap-5 flex-1 min-h-0 h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Auditoria</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {metaTotal} registro(s) — clique em uma linha para ver os valores alterados
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchLogs(page)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors"
        >
          <ArrowClockwise size={15} /> Atualizar
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-5 pr-2 pb-4">
        <div className="bg-card rounded-lg border border-border shadow-sm p-5 space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="filtro-data-inicio" className="text-xs text-muted-foreground">Data início</label>
              <input
                id="filtro-data-inicio"
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className={selectClass}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="filtro-data-fim" className="text-xs text-muted-foreground">Data fim</label>
              <input
                id="filtro-data-fim"
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className={selectClass}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="filtro-entidade" className="text-xs text-muted-foreground">Entidade</label>
              <select id="filtro-entidade" value={entidadeTipo} onChange={(e) => setEntidadeTipo(e.target.value)} className={selectClass}>
                <option value="">Todas as entidades</option>
                {ENTIDADE_TIPOS.filter(Boolean).map((t) => (
                  <option key={t} value={t}>{entidadeLabel(t)}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="filtro-acao" className="text-xs text-muted-foreground">Ação</label>
              <select id="filtro-acao" value={acao} onChange={(e) => setAcao(e.target.value as AuditAcao | '')} className={selectClass}>
                {ACOES.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </div>

            {usuarios.length > 0 && (
              <div className="flex flex-col gap-1">
                <label htmlFor="filtro-usuario" className="text-xs text-muted-foreground">Usuário</label>
                <select id="filtro-usuario" value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)} className={selectClass}>
                  <option value="">Todos os usuários</option>
                  {usuarios.map((u) => (
                    <option key={u.id} value={u.id}>{u.nome}</option>
                  ))}
                </select>
              </div>
            )}

            {temFiltro && (
              <button
                type="button"
                onClick={limparFiltros}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-muted-foreground hover:underline transition-colors pb-2"
              >
                <X size={12} /> Limpar filtros
              </button>
            )}
          </div>

          <DataTable
            columns={columns}
            data={logs}
            isLoading={isLoading}
            keyExtractor={(log) => log.id}
            emptyMessage="Nenhum registro de auditoria encontrado."
            onRowClick={(log) => setSelectedLog(log)}
          />

          <Pagination
            page={page}
            totalPages={metaTotalPages}
            total={metaTotal}
            limit={PAGE_SIZE}
            onPageChange={setPage}
          />
        </div>
      </div>

      {selectedLog && (
        <DetalheModal
          log={selectedLog}
          onClose={() => setSelectedLog(null)}
          nomeUsuario={nomeUsuario}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
