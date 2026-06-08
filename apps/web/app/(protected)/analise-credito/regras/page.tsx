'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  ArrowClockwise, PencilSimple, ToggleLeft, ToggleRight,
  Warning, Info, CheckCircle, X, FloppyDisk,
} from '@phosphor-icons/react';
import { regrasApi, CreditoRegra, UpdateRegraPayload } from '@/lib/analise-credito-api';
import { useToast, ToastContainer } from '@/components/ui/toast';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEV_META = {
  critico:  { label: 'Crítico',  bg: 'bg-red-100',    text: 'text-red-700',    icon: Warning,       dot: 'bg-red-500'    },
  atencao:  { label: 'Atenção',  bg: 'bg-amber-100',  text: 'text-amber-700',  icon: Info,          dot: 'bg-amber-500'  },
  positivo: { label: 'Positivo', bg: 'bg-emerald-100', text: 'text-emerald-700', icon: CheckCircle,  dot: 'bg-emerald-500' },
} as const;

function SevBadge({ sev }: { sev: string }) {
  const m = SEV_META[sev as keyof typeof SEV_META];
  if (!m) return <span className="text-xs text-muted-foreground">{sev}</span>;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${m.bg} ${m.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
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

function EditModal({ regra, onClose, onSaved }: EditModalProps) {
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
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">

          {/* Nome */}
          <div>
            <label className={labelCls}>Nome</label>
            <input className={inputCls} value={form.nome ?? ''} onChange={e => set('nome', e.target.value)} />
          </div>

          {/* Descrição */}
          <div>
            <label className={labelCls}>Descrição</label>
            <textarea className={`${inputCls} resize-none`} rows={2}
              value={form.descricao ?? ''} onChange={e => set('descricao', e.target.value)} />
          </div>

          {/* Severidade + Categoria */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Severidade</label>
              <select className={inputCls} value={form.severidade} onChange={e => set('severidade', e.target.value)}>
                <option value="critico">Crítico</option>
                <option value="atencao">Atenção</option>
                <option value="positivo">Positivo</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Categoria</label>
              <input className={inputCls} value={form.categoria ?? ''} onChange={e => set('categoria', e.target.value)} />
            </div>
          </div>

          {/* Thresholds */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Threshold 1 (limite principal)</label>
              <input type="number" step="any" className={inputCls}
                value={form.threshold1 ?? ''} placeholder="—"
                onChange={e => set('threshold1', e.target.value === '' ? null : Number(e.target.value))} />
            </div>
            <div>
              <label className={labelCls}>Threshold 2 (limite secundário)</label>
              <input type="number" step="any" className={inputCls}
                value={form.threshold2 ?? ''} placeholder="—"
                onChange={e => set('threshold2', e.target.value === '' ? null : Number(e.target.value))} />
            </div>
          </div>

          {/* Template da mensagem */}
          <div>
            <label className={labelCls}>Template da mensagem</label>
            <textarea className={`${inputCls} resize-none font-mono text-xs`} rows={3}
              value={form.templateMensagem ?? ''} onChange={e => set('templateMensagem', e.target.value)} />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Placeholders: <code className="bg-muted px-1 rounded">{'{val}'}</code> valor atual &nbsp;·&nbsp;
              <code className="bg-muted px-1 rounded">{'{valAnt}'}</code> valor anterior &nbsp;·&nbsp;
              <code className="bg-muted px-1 rounded">{'{valAbs}'}</code> abs &nbsp;·&nbsp;
              <code className="bg-muted px-1 rounded">{'{th1}'}</code>/<code className="bg-muted px-1 rounded">{'{th1pct}'}</code> threshold &nbsp;·&nbsp;
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
              : <FloppyDisk size={15} />}
            Salvar
          </button>
        </div>
      </div>
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
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
  const [regras, setRegras]       = useState<CreditoRegra[]>([]);
  const [loading, setLoading]     = useState(true);
  const [editing, setEditing]     = useState<CreditoRegra | null>(null);
  const [toggling, setToggling]   = useState<string | null>(null);
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
            Configure thresholds, mensagens e severidade das {regras.length} regras de análise.
          </p>
        </div>
        <button type="button" onClick={() => void load()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors">
          <ArrowClockwise size={15} />
        </button>
      </div>

      {/* Grupos de regras */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(k => <div key={k} className="h-32 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : (
        GRUPOS.map(grupo => {
          const lista = regras.filter(r => r.severidade === grupo);
          if (lista.length === 0) return null;
          const meta = SEV_META[grupo];
          return (
            <section key={grupo}>
              <div className={`flex items-center gap-2 mb-3 px-1`}>
                <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                <h2 className="text-sm font-semibold text-foreground">{GRUPO_LABEL[grupo]}</h2>
                <span className="text-xs text-muted-foreground">({lista.length})</span>
              </div>

              <div className="rounded-lg border border-input overflow-hidden shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted border-b border-border">
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-20">Código</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nome</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-36">Indicador</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-28">Threshold 1</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-28">Threshold 2</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-28">Categoria</th>
                      <th className="px-4 py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider w-20">Ativo</th>
                      <th className="px-4 py-2.5 w-14" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {lista.map(regra => (
                      <tr key={regra.id} className={`transition-colors ${regra.ativo ? 'bg-card hover:bg-muted/40' : 'bg-muted/20 opacity-60'}`}>
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs font-semibold text-muted-foreground">{regra.codigoRegra}</span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground text-sm leading-tight">{regra.nome}</p>
                          {regra.descricao && (
                            <p className="text-xs text-muted-foreground mt-0.5 leading-snug line-clamp-1">{regra.descricao}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-foreground">{regra.indicador}</code>
                          {regra.indicador2 && (
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-foreground ml-1">{regra.indicador2}</code>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground font-mono">
                          {regra.threshold1 !== null ? regra.threshold1 : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground font-mono">
                          {regra.threshold2 !== null ? regra.threshold2 : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-muted-foreground">{regra.categoria}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            type="button"
                            disabled={toggling === regra.id}
                            onClick={() => void handleToggle(regra)}
                            title={regra.ativo ? 'Desativar regra' : 'Ativar regra'}
                            className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                          >
                            {toggling === regra.id
                              ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent inline-block" />
                              : regra.ativo
                                ? <ToggleRight size={22} className="text-primary" />
                                : <ToggleLeft size={22} />}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => setEditing(regra)}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                            title="Editar regra"
                          >
                            <PencilSimple size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}

      {editing && (
        <EditModal regra={editing} onClose={() => setEditing(null)} onSaved={handleSaved} />
      )}

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
