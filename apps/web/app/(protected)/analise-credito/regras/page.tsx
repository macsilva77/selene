'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  ArrowClockwiseIcon, PencilSimpleIcon, ToggleLeftIcon, ToggleRightIcon,
  WarningCircleIcon, InfoIcon, CheckCircleIcon, XIcon, FloppyDiskIcon,
} from '@phosphor-icons/react';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { regrasApi, type CreditoRegra, type UpdateRegraPayload } from '@/lib/analise-credito-api';
import { useToast, ToastContainer } from '@/components/ui/toast';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEV_META = {
  critico:  { label: 'Crítico',  bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200',     groupDot: 'bg-red-500',     Icon: WarningCircleIcon },
  atencao:  { label: 'Atenção',  bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   groupDot: 'bg-amber-500',   Icon: InfoIcon          },
  positivo: { label: 'Positivo', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', groupDot: 'bg-emerald-500', Icon: CheckCircleIcon   },
} as const;

function SevBadge({ sev }: Readonly<{ sev: string }>) {
  const m = SEV_META[sev as keyof typeof SEV_META];
  if (!m) return <span className="text-xs text-muted-foreground">{sev}</span>;
  const { Icon } = m;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${m.bg} ${m.text} ${m.border}`}>
      <Icon size={11} weight="fill" />
      {m.label}
    </span>
  );
}

// ─── Modal de edição ──────────────────────────────────────────────────────────

interface EditModalProps {
  regra:   CreditoRegra;
  onClose: () => void;
  onSaved: (updated: CreditoRegra) => void;
}

function EditModal({ regra, onClose, onSaved }: Readonly<EditModalProps>) {
  const [form, setForm] = useState<UpdateRegraPayload>({
    nome:             regra.nome,
    descricao:        regra.descricao ?? '',
    severidade:       regra.severidade,
    categoria:        regra.categoria,
    threshold1:       regra.threshold1,
    threshold2:       regra.threshold2,
    templateMensagem: regra.templateMensagem,
  });
  const [saving, setSaving] = useState(false);
  const { toasts, error: toastError, success, dismiss } = useToast();

  const set = <K extends keyof UpdateRegraPayload>(k: K, v: UpdateRegraPayload[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await regrasApi.atualizar(regra.id, form);
      success('Regra atualizada com sucesso!');
      setTimeout(() => { onSaved(updated); onClose(); }, 800);
    } catch {
      toastError('Erro ao salvar regra.');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors';
  const labelCls = 'block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-card rounded-xl shadow-2xl border border-input overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <p className="text-xs text-muted-foreground font-mono">{regra.codigoRegra}</p>
            <h2 className="text-base font-semibold text-foreground mt-0.5">Editar Regra</h2>
          </div>
          <button type="button" onClick={onClose} title="Fechar"
            className="text-muted-foreground hover:text-foreground transition-colors">
            <XIcon size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">

          <div>
            <label className={labelCls}>Nome</label>
            <input aria-label="Nome da regra" className={inputCls}
              value={form.nome ?? ''} onChange={e => set('nome', e.target.value)} />
          </div>

          <div>
            <label className={labelCls}>Descrição</label>
            <textarea aria-label="Descrição da regra" className={`${inputCls} resize-none`} rows={2}
              value={form.descricao ?? ''} onChange={e => set('descricao', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Severidade</label>
              <select aria-label="Severidade" className={inputCls}
                value={form.severidade} onChange={e => set('severidade', e.target.value)}>
                <option value="critico">Crítico</option>
                <option value="atencao">Atenção</option>
                <option value="positivo">Positivo</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Categoria</label>
              <input aria-label="Categoria" className={inputCls}
                value={form.categoria ?? ''} onChange={e => set('categoria', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Limite 1 — parâmetro principal</label>
              <input aria-label="Limite 1" type="number" step="any" className={inputCls}
                value={form.threshold1 ?? ''} placeholder="—"
                onChange={e => set('threshold1', e.target.value === '' ? null : Number(e.target.value))} />
            </div>
            <div>
              <label className={labelCls}>Limite 2 — parâmetro secundário</label>
              <input aria-label="Limite 2" type="number" step="any" className={inputCls}
                value={form.threshold2 ?? ''} placeholder="—"
                onChange={e => set('threshold2', e.target.value === '' ? null : Number(e.target.value))} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Template da mensagem</label>
            <textarea aria-label="Template da mensagem" className={`${inputCls} resize-none font-mono text-xs`} rows={3}
              value={form.templateMensagem ?? ''} onChange={e => set('templateMensagem', e.target.value)} />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Placeholders: <code className="bg-muted px-1 rounded">{'{val}'}</code> valor atual &nbsp;·&nbsp;
              <code className="bg-muted px-1 rounded">{'{valAnt}'}</code> anterior &nbsp;·&nbsp;
              <code className="bg-muted px-1 rounded">{'{valAbs}'}</code> abs &nbsp;·&nbsp;
              <code className="bg-muted px-1 rounded">{'{th1}'}</code>/<code className="bg-muted px-1 rounded">{'{th1pct}'}</code> limite &nbsp;·&nbsp;
              <code className="bg-muted px-1 rounded">{'{n}'}</code> contador
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-lg border border-input text-sm text-foreground hover:bg-muted transition-colors">
            Cancelar
          </button>
          <button type="button" disabled={saving} onClick={() => void handleSave()}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50">
            {saving
              ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              : <FloppyDiskIcon size={15} />}
            Salvar
          </button>
        </div>
      </div>
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

// ─── Toggle cell ──────────────────────────────────────────────────────────────

function ToggleCell({ regra, toggling, onToggle }: Readonly<{
  regra: CreditoRegra;
  toggling: string | null;
  onToggle: (r: CreditoRegra) => void;
}>) {
  const isLoading = toggling === regra.id;
  const icon = regra.ativo
    ? <ToggleRightIcon size={22} className="text-primary" />
    : <ToggleLeftIcon size={22} />;

  return (
    <TableCell className="text-center">
      <button
        type="button"
        disabled={isLoading}
        onClick={() => onToggle(regra)}
        title={regra.ativo ? 'Desativar regra' : 'Ativar regra'}
        className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
      >
        {isLoading
          ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent inline-block" />
          : icon}
      </button>
    </TableCell>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

const GRUPOS = ['critico', 'atencao', 'positivo'] as const;
const GRUPO_LABEL: Record<string, string> = {
  critico:  'Alertas Críticos',
  atencao:  'Pontos de Atenção',
  positivo: 'Indicadores Positivos',
};

export default function RegrasPage() {
  const [regras, setRegras]     = useState<CreditoRegra[]>([]);
  const [loading, setLoading]   = useState(true);
  const [editing, setEditing]   = useState<CreditoRegra | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const { toasts, error: toastError, success, dismiss } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRegras(await regrasApi.listar());
    } catch {
      toastError('Erro ao carregar regras.');
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

  const handleToggle = async (regra: CreditoRegra) => {
    setToggling(regra.id);
    try {
      const updated = await regrasApi.toggle(regra.id);
      setRegras(prev => prev.map(r => r.id === updated.id ? updated : r));
      success(updated.ativo ? 'Regra ativada.' : 'Regra desativada.');
    } catch {
      toastError('Erro ao alterar status da regra.');
    } finally {
      setToggling(null);
    }
  };

  const handleSaved = (updated: CreditoRegra) =>
    setRegras(prev => prev.map(r => r.id === updated.id ? updated : r));

  return (
    <div className="flex flex-col gap-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Regras de Crédito</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure limites, mensagens e severidade das {regras.length} regras de análise.
          </p>
        </div>
        <button type="button" title="Recarregar" onClick={() => void load()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors">
          <ArrowClockwiseIcon size={15} />
        </button>
      </div>

      {/* Skeleton */}
      {loading && (
        <div className="space-y-4">
          {[1, 2, 3].map(k => <div key={k} className="h-32 rounded-lg bg-muted animate-pulse" />)}
        </div>
      )}

      {/* Grupos de regras */}
      {!loading && GRUPOS.map(grupo => {
        const lista = regras.filter(r => r.severidade === grupo);
        if (lista.length === 0) return null;
        const meta = SEV_META[grupo];

        return (
          <section key={grupo}>
            {/* Cabeçalho do grupo */}
            <div className="flex items-center gap-2 mb-3 px-1">
              <span className={`h-2 w-2 rounded-full ${meta.groupDot}`} />
              <h2 className="text-sm font-semibold text-foreground">{GRUPO_LABEL[grupo]}</h2>
              <span className="text-xs text-muted-foreground">({lista.length} regras)</span>
            </div>

            {/* Tabela */}
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="w-20">Código</TableHead>
                    <TableHead className="w-28">Severidade</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead className="w-32">Indicador</TableHead>
                    <TableHead className="w-24 text-right">Limite 1</TableHead>
                    <TableHead className="w-24 text-right">Limite 2</TableHead>
                    <TableHead className="w-32">Categoria</TableHead>
                    <TableHead>Mensagem</TableHead>
                    <TableHead className="w-16 text-center">Ativo</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lista.map(regra => (
                    <TableRow
                      key={regra.id}
                      className={regra.ativo ? '' : 'opacity-50 bg-muted/20'}
                    >
                      {/* Código */}
                      <TableCell>
                        <span className="font-mono text-xs font-semibold text-muted-foreground">
                          {regra.codigoRegra}
                        </span>
                      </TableCell>

                      {/* Severidade */}
                      <TableCell>
                        <SevBadge sev={regra.severidade} />
                      </TableCell>

                      {/* Nome + descrição */}
                      <TableCell className="whitespace-normal">
                        <p className="font-medium text-foreground text-sm leading-tight">{regra.nome}</p>
                        {regra.descricao && (
                          <p className="text-xs text-muted-foreground mt-0.5 leading-snug line-clamp-2">
                            {regra.descricao}
                          </p>
                        )}
                      </TableCell>

                      {/* Indicador(es) */}
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-foreground w-fit">
                            {regra.indicador}
                          </code>
                          {regra.indicador2 && (
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground w-fit">
                              {regra.indicador2}
                            </code>
                          )}
                        </div>
                      </TableCell>

                      {/* Limite 1 */}
                      <TableCell className="text-right font-mono text-sm">
                        {regra.threshold1 !== null
                          ? <span className="text-foreground">{regra.threshold1}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>

                      {/* Limite 2 */}
                      <TableCell className="text-right font-mono text-sm">
                        {regra.threshold2 !== null
                          ? <span className="text-foreground">{regra.threshold2}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>

                      {/* Categoria */}
                      <TableCell>
                        <span className="text-xs text-muted-foreground">{regra.categoria}</span>
                      </TableCell>

                      {/* Mensagem template */}
                      <TableCell className="whitespace-normal max-w-xs">
                        <span className="text-xs text-foreground font-mono leading-snug line-clamp-2">
                          {regra.templateMensagem}
                        </span>
                      </TableCell>

                      {/* Toggle ativo */}
                      <ToggleCell regra={regra} toggling={toggling} onToggle={r => void handleToggle(r)} />

                      {/* Editar */}
                      <TableCell className="text-center">
                        <button
                          type="button"
                          onClick={() => setEditing(regra)}
                          title="Editar regra"
                          className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        >
                          <PencilSimpleIcon size={14} />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        );
      })}

      {editing && (
        <EditModal regra={editing} onClose={() => setEditing(null)} onSaved={handleSaved} />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
