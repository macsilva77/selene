'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { TagIcon, PlusIcon, PencilSimpleIcon, TrashIcon, StarIcon, CheckIcon, XIcon } from '@phosphor-icons/react';
import { Modal } from '@/components/ui/modal';
import { useToast, ToastContainer } from '@/components/ui/toast';
import { api } from '@/lib/api';

/* ─────────────────────────────────────────────────────────────────── */
/* Types                                                               */
/* ─────────────────────────────────────────────────────────────────── */

interface Etiqueta {
  id: string;
  nome: string;
  cor: string;
  padrao: boolean;
  criadoEm: string;
  atualizadoEm: string;
  _count: { documentos: number };
}

interface EtiquetaForm {
  nome: string;
  cor: string;
  padrao: boolean;
}

/* ─────────────────────────────────────────────────────────────────── */
/* Color palette                                                       */
/* ─────────────────────────────────────────────────────────────────── */

const PALETTE = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E',
  '#14B8A6', '#3B82F6', '#8B5CF6', '#EC4899',
  '#64748B', '#374151', '#0EA5E9', '#10B981',
  '#F59E0B', '#84CC16', '#6366F1', '#DB2777',
];

const EMPTY_FORM: EtiquetaForm = { nome: '', cor: PALETTE[0], padrao: false };

/* ─────────────────────────────────────────────────────────────────── */
/* Helpers                                                             */
/* ─────────────────────────────────────────────────────────────────── */

function isValidHex(v: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(v);
}

function getTextColor(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#111827' : '#FFFFFF';
}

function EtiquetaBadge({ nome, cor }: { nome: string; cor: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ backgroundColor: cor, color: getTextColor(cor) }}
    >
      <TagIcon size={10} weight="fill" />
      {nome}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Color Picker                                                        */
/* ─────────────────────────────────────────────────────────────────── */

function ColorPicker({
  value,
  onChange,
  usedColors,
  excludeId,
}: {
  value: string;
  onChange: (cor: string) => void;
  usedColors: string[];
  excludeId?: string | null;
}) {
  const [hex, setHex] = useState(value);

  useEffect(() => { setHex(value); }, [value]);

  const handleHexChange = (raw: string) => {
    const v = raw.startsWith('#') ? raw : `#${raw}`;
    setHex(v);
    if (isValidHex(v)) onChange(v);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-8 gap-1.5">
        {PALETTE.map((c) => {
          const inUse = usedColors.includes(c) && c !== value;
          return (
            <button
              key={c}
              type="button"
              title={inUse ? `${c} — já em uso` : c}
              disabled={inUse}
              onClick={() => { onChange(c); setHex(c); }}
              className={[
                'h-7 w-7 rounded-md transition-all border-2',
                value === c ? 'border-foreground scale-110 shadow-md' : 'border-transparent',
                inUse ? 'opacity-30 cursor-not-allowed' : 'hover:scale-110 hover:shadow-md cursor-pointer',
              ].join(' ')}
              style={{ backgroundColor: c }}
            >
              {value === c && (
                <CheckIcon size={12} style={{ color: getTextColor(c), margin: 'auto' }} />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <div
          className="h-8 w-8 shrink-0 rounded-md border border-border"
          style={{ backgroundColor: isValidHex(hex) ? hex : '#e5e7eb' }}
        />
        <input
          type="text"
          value={hex}
          onChange={(e) => handleHexChange(e.target.value)}
          placeholder="#RRGGBB"
          maxLength={7}
          className="flex-1 rounded-lg border border-input px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
        />
        {!isValidHex(hex) && hex.length > 1 && (
          <span className="text-xs text-destructive shrink-0">Formato inválido</span>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Modal de Formulário                                                 */
/* ─────────────────────────────────────────────────────────────────── */

function EtiquetaFormModal({
  isOpen,
  editando,
  form,
  setForm,
  onClose,
  onSave,
  salvando,
  erroForm,
  usedColors,
  usedNomes,
}: {
  isOpen: boolean;
  editando: Etiqueta | null;
  form: EtiquetaForm;
  setForm: React.Dispatch<React.SetStateAction<EtiquetaForm>>;
  onClose: () => void;
  onSave: () => void;
  salvando: boolean;
  erroForm: string | null;
  usedColors: string[];
  usedNomes: string[];
}) {
  const nomeConflito = form.nome.trim() && usedNomes.includes(form.nome.trim()) && form.nome.trim() !== editando?.nome;
  const corConflito = usedColors.includes(form.cor) && form.cor !== editando?.cor;
  const hexInvalido = !isValidHex(form.cor);
  const canSave = form.nome.trim() && !hexInvalido && !nomeConflito && !corConflito && !salvando;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editando ? 'Editar etiqueta' : 'Nova etiqueta'}
      size="sm"
    >
      <div className="space-y-4">
        {/* Nome */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            Nome <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            value={form.nome}
            onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
            placeholder="Ex.: Urgente"
            maxLength={100}
            className={[
              'w-full rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors',
              nomeConflito ? 'border-destructive' : 'border-input',
            ].join(' ')}
          />
          {nomeConflito && (
            <p className="mt-1 text-xs text-destructive">Já existe uma etiqueta com este nome</p>
          )}
        </div>

        {/* Cor */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            Cor <span className="text-destructive">*</span>
          </label>
          <ColorPicker
            value={form.cor}
            onChange={(cor) => setForm((f) => ({ ...f, cor }))}
            usedColors={usedColors}
            excludeId={editando?.id}
          />
          {corConflito && (
            <p className="mt-1 text-xs text-destructive">Esta cor já está em uso</p>
          )}
        </div>

        {/* Pré-visualização */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Pré-visualização:</span>
          <EtiquetaBadge nome={form.nome || 'Nome da etiqueta'} cor={form.cor} />
        </div>

        {/* Padrão */}
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.padrao}
            onChange={(e) => setForm((f) => ({ ...f, padrao: e.target.checked }))}
            className="h-4 w-4 rounded border-input accent-primary"
          />
          <div>
            <p className="text-sm font-medium text-foreground">Definir como etiqueta padrão</p>
            <p className="text-xs text-muted-foreground">Apenas uma etiqueta pode ser padrão. A atual será substituída.</p>
          </div>
        </label>

        {erroForm && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
            {erroForm}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Confirm Delete Modal                                                */
/* ─────────────────────────────────────────────────────────────────── */

function ConfirmDeleteModal({
  isOpen,
  etiqueta,
  onClose,
  onConfirm,
  excluindo,
}: {
  isOpen: boolean;
  etiqueta: Etiqueta | null;
  onClose: () => void;
  onConfirm: () => void;
  excluindo: boolean;
}) {
  if (!etiqueta) return null;
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Excluir etiqueta" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-foreground">
          Tem certeza que deseja excluir a etiqueta{' '}
          <EtiquetaBadge nome={etiqueta.nome} cor={etiqueta.cor} />?
        </p>
        {etiqueta._count.documentos > 0 && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            Esta etiqueta está associada a {etiqueta._count.documentos} documento(s) e não pode ser excluída.
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={excluindo || etiqueta._count.documentos > 0}
            className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-white hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {excluindo ? 'Excluindo…' : 'Excluir'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Page                                                                */
/* ─────────────────────────────────────────────────────────────────── */

export default function EtiquetasPage() {
  const { toasts, success, error: toastError, dismiss } = useToast();

  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState<Etiqueta | null>(null);
  const [form, setForm] = useState<EtiquetaForm>(EMPTY_FORM);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<Etiqueta | null>(null);
  const [excluindo, setExcluindo] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<Etiqueta[]>('/etiquetas');
      setEtiquetas(Array.isArray(res.data) ? res.data : []);
    } catch {
      toastError('Erro ao carregar etiquetas');
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void carregar(); }, [carregar]);

  const abrirNova = () => {
    setEditando(null);
    setForm(EMPTY_FORM);
    setErroForm(null);
    setModalAberto(true);
  };

  const abrirEditar = (e: Etiqueta) => {
    setEditando(e);
    setForm({ nome: e.nome, cor: e.cor, padrao: e.padrao });
    setErroForm(null);
    setModalAberto(true);
  };

  const fecharModal = () => {
    setModalAberto(false);
    setEditando(null);
    setErroForm(null);
  };

  const salvar = async () => {
    setSalvando(true);
    setErroForm(null);
    try {
      if (editando) {
        await api.patch(`/etiquetas/${editando.id}`, form);
        success('Etiqueta atualizada');
      } else {
        await api.post('/etiquetas', form);
        success('Etiqueta criada');
      }
      fecharModal();
      void carregar();
    } catch (err: any) {
      const msg: string = err?.response?.data?.message ?? 'Erro ao salvar etiqueta';
      setErroForm(Array.isArray(msg) ? msg.join('; ') : String(msg));
    } finally {
      setSalvando(false);
    }
  };

  const excluir = async () => {
    if (!confirmDelete) return;
    setExcluindo(true);
    try {
      await api.delete(`/etiquetas/${confirmDelete.id}`);
      success(`Etiqueta "${confirmDelete.nome}" excluída`);
      setConfirmDelete(null);
      void carregar();
    } catch (err: any) {
      const msg: string = err?.response?.data?.message ?? 'Erro ao excluir etiqueta';
      toastError(Array.isArray(msg) ? msg.join('; ') : String(msg));
      setConfirmDelete(null);
    } finally {
      setExcluindo(false);
    }
  };

  const usedColors = etiquetas
    .filter((e) => !editando || e.id !== editando.id)
    .map((e) => e.cor);
  const usedNomes = etiquetas
    .filter((e) => !editando || e.id !== editando.id)
    .map((e) => e.nome);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <TagIcon size={22} weight="duotone" className="text-primary" />
            Etiquetas
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Classifique documentos fiscais com etiquetas coloridas
          </p>
        </div>
        <button
          type="button"
          onClick={abrirNova}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <PlusIcon size={16} />
          Nova etiqueta
        </button>
      </div>

      {/* List */}
      <div className="rounded-xl border border-border bg-card">
        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4 animate-pulse">
                <div className="h-6 w-20 rounded-full bg-muted" />
                <div className="h-4 w-32 rounded bg-muted" />
                <div className="ml-auto h-4 w-16 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : etiquetas.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <TagIcon size={40} className="text-muted-foreground/40" weight="duotone" />
            <div>
              <p className="text-sm font-medium text-foreground">Nenhuma etiqueta cadastrada</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Crie etiquetas para classificar seus documentos fiscais
              </p>
            </div>
            <button
              type="button"
              onClick={abrirNova}
              className="mt-1 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <PlusIcon size={13} />
              Criar primeira etiqueta
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {etiquetas.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/30 transition-colors"
              >
                {/* Badge */}
                <EtiquetaBadge nome={e.nome} cor={e.cor} />

                {/* Padrão */}
                {e.padrao && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 border border-amber-200">
                    <StarIcon size={10} weight="fill" />
                    Padrão
                  </span>
                )}

                {/* Contagem de documentos */}
                <span className="text-xs text-muted-foreground">
                  {e._count.documentos} documento{e._count.documentos !== 1 ? 's' : ''}
                </span>

                {/* Hex preview */}
                <span className="text-xs font-mono text-muted-foreground">{e.cor}</span>

                {/* Actions */}
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    title="Editar"
                    onClick={() => abrirEditar(e)}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <PencilSimpleIcon size={14} />
                  </button>
                  <button
                    type="button"
                    title="Excluir"
                    onClick={() => setConfirmDelete(e)}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      <EtiquetaFormModal
        isOpen={modalAberto}
        editando={editando}
        form={form}
        setForm={setForm}
        onClose={fecharModal}
        onSave={salvar}
        salvando={salvando}
        erroForm={erroForm}
        usedColors={usedColors}
        usedNomes={usedNomes}
      />

      <ConfirmDeleteModal
        isOpen={confirmDelete !== null}
        etiqueta={confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={excluir}
        excluindo={excluindo}
      />

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
