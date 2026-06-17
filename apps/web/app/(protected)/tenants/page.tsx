'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  StorefrontIcon,
  PlusIcon,
  PencilSimpleIcon,
  ProhibitIcon,
  CheckCircleIcon,
  ArrowClockwiseIcon,
  MagnifyingGlassIcon,
} from '@phosphor-icons/react';
import { Modal } from '@/components/ui/modal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast, ToastContainer } from '@/components/ui/toast';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  tenantsApi,
  type Tenant,
  type TenantMeta,
  type PlanoTenant,
} from '@/lib/tenants-api';

// ─── Constants ────────────────────────────────────────────────────────────────

const PLANOS: { value: PlanoTenant; label: string }[] = [
  { value: 'free',         label: 'Free' },
  { value: 'starter',      label: 'Starter' },
  { value: 'professional', label: 'Professional' },
  { value: 'enterprise',   label: 'Enterprise' },
];

const PLANO_BADGE: Record<PlanoTenant, string> = {
  free:         'bg-slate-100 text-slate-700',
  starter:      'bg-blue-100 text-blue-700',
  professional: 'bg-purple-100 text-purple-700',
  enterprise:   'bg-amber-100 text-amber-700',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSlug(nome: string) {
  return nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function maskCnpj(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function planoLabel(v: PlanoTenant) {
  return PLANOS.find(p => p.value === v)?.label ?? v;
}

// ─── Form types ───────────────────────────────────────────────────────────────

interface CreateForm {
  nome: string;
  slug: string;
  slugEdited: boolean;
  cnpj: string;
  plano: PlanoTenant;
}

interface EditForm {
  nome: string;
  cnpj: string;
  plano: PlanoTenant;
  diretorNome: string;
  diretorCargo: string;
  diretorEmail: string;
  diretorDesignadoEm: string;
}

const EMPTY_CREATE: CreateForm = {
  nome: '',
  slug: '',
  slugEdited: false,
  cnpj: '',
  plano: 'starter',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TenantsPage() {
  const { toasts, success, error, dismiss } = useToast();

  const [tenants, setTenants]   = useState<Tenant[]>([]);
  const [meta, setMeta]         = useState<TenantMeta | null>(null);
  const [loading, setLoading]   = useState(true);
  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState('');

  const [showCreate, setShowCreate]     = useState(false);
  const [showEdit, setShowEdit]         = useState(false);
  const [createForm, setCreateForm]     = useState<CreateForm>(EMPTY_CREATE);
  const [editForm, setEditForm]         = useState<EditForm | null>(null);
  const [editTarget, setEditTarget]     = useState<Tenant | null>(null);
  const [confirmSuspend, setConfirmSuspend]   = useState<Tenant | null>(null);
  const [confirmReativar, setConfirmReativar] = useState<Tenant | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await tenantsApi.listar(p, 20);
      setTenants(res.data);
      setMeta(res.meta);
    } catch {
      error('Erro ao carregar tenants');
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => { void load(page); }, [load, page]);

  // ── Stats ──────────────────────────────────────────────────────────────────

  const total     = meta?.total ?? 0;
  const ativos    = tenants.filter(t => t.ativo).length;
  const suspensos = tenants.filter(t => !t.ativo).length;

  // ── Search (client-side within current page) ───────────────────────────────

  const filtered = search
    ? tenants.filter(t => {
        const q = search.toLowerCase();
        return (
          t.nome.toLowerCase().includes(q) ||
          t.slug.toLowerCase().includes(q) ||
          (t.cnpj ?? '').includes(q)
        );
      })
    : tenants;

  // ── Create ─────────────────────────────────────────────────────────────────

  function openCreate() {
    setCreateForm(EMPTY_CREATE);
    setShowCreate(true);
  }

  function updateCreateNome(nome: string) {
    setCreateForm(f => ({
      ...f,
      nome,
      slug: f.slugEdited ? f.slug : toSlug(nome),
    }));
  }

  async function handleCreate() {
    if (!createForm.nome.trim() || !createForm.slug.trim()) return;
    setSaving(true);
    try {
      await tenantsApi.criar({
        nome:  createForm.nome.trim(),
        slug:  createForm.slug.trim(),
        cnpj:  createForm.cnpj.replace(/\D/g, '') || undefined,
        plano: createForm.plano,
      });
      success('Tenant criado com sucesso');
      setShowCreate(false);
      setPage(1);
      await load(1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao criar tenant';
      error(msg);
    } finally {
      setSaving(false);
    }
  }

  // ── Edit ───────────────────────────────────────────────────────────────────

  function openEdit(t: Tenant) {
    setEditTarget(t);
    setEditForm({
      nome:               t.nome,
      cnpj:               t.cnpj ?? '',
      plano:              t.plano,
      diretorNome:        t.diretorNome ?? '',
      diretorCargo:       t.diretorCargo ?? '',
      diretorEmail:       t.diretorEmail ?? '',
      diretorDesignadoEm: t.diretorDesignadoEm ? t.diretorDesignadoEm.slice(0, 10) : '',
    });
    setShowEdit(true);
  }

  async function handleEdit() {
    if (!editTarget || !editForm || !editForm.nome.trim()) return;
    setSaving(true);
    try {
      await tenantsApi.atualizar(editTarget.id, {
        nome:               editForm.nome.trim(),
        cnpj:               editForm.cnpj.replace(/\D/g, '') || undefined,
        plano:              editForm.plano,
        diretorNome:        editForm.diretorNome.trim()  || undefined,
        diretorCargo:       editForm.diretorCargo.trim() || undefined,
        diretorEmail:       editForm.diretorEmail.trim() || undefined,
        diretorDesignadoEm: editForm.diretorDesignadoEm || undefined,
      });
      success('Tenant atualizado');
      setShowEdit(false);
      await load(page);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao atualizar';
      error(msg);
    } finally {
      setSaving(false);
    }
  }

  // ── Suspend / Reativar ─────────────────────────────────────────────────────

  async function handleSuspender() {
    if (!confirmSuspend) return;
    try {
      await tenantsApi.suspender(confirmSuspend.id);
      success('Tenant suspenso');
      setConfirmSuspend(null);
      await load(page);
    } catch {
      error('Erro ao suspender tenant');
    }
  }

  async function handleReativar() {
    if (!confirmReativar) return;
    try {
      await tenantsApi.reativar(confirmReativar.id);
      success('Tenant reativado');
      setConfirmReativar(null);
      await load(page);
    } catch {
      error('Erro ao reativar tenant');
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      <ConfirmDialog
        isOpen={!!confirmSuspend}
        title="Suspender tenant"
        message={`Deseja suspender "${confirmSuspend?.nome}"? Os usuários perderão acesso ao sistema.`}
        confirmLabel="Suspender"
        onConfirm={() => void handleSuspender()}
        onCancel={() => setConfirmSuspend(null)}
      />
      <ConfirmDialog
        isOpen={!!confirmReativar}
        title="Reativar tenant"
        message={`Deseja reativar "${confirmReativar?.nome}"?`}
        confirmLabel="Reativar"
        onConfirm={() => void handleReativar()}
        onCancel={() => setConfirmReativar(null)}
      />

      {/* ── Create Modal ────────────────────────────────────────────────── */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Novo Tenant" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Nome <span className="text-destructive">*</span>
            </label>
            <input
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={createForm.nome}
              onChange={e => updateCreateNome(e.target.value)}
              placeholder="Acme Corporation"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Slug <span className="text-destructive">*</span>
            </label>
            <input
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              value={createForm.slug}
              onChange={e =>
                setCreateForm(f => ({
                  ...f,
                  slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                  slugEdited: true,
                }))
              }
              placeholder="acme-corporation"
            />
            <p className="mt-1 text-xs text-muted-foreground">Gerado automaticamente. Apenas letras minúsculas, números e hífens.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">CNPJ</label>
            <input
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={createForm.cnpj}
              onChange={e => setCreateForm(f => ({ ...f, cnpj: maskCnpj(e.target.value) }))}
              placeholder="00.000.000/0001-00"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Plano</label>
            <select
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={createForm.plano}
              onChange={e => setCreateForm(f => ({ ...f, plano: e.target.value as PlanoTenant }))}
            >
              {PLANOS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted text-muted-foreground transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={saving || !createForm.nome.trim() || !createForm.slug.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-50"
            >
              {saving ? 'Criando…' : 'Criar Tenant'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Edit Modal ──────────────────────────────────────────────────── */}
      {editForm && (
        <Modal
          isOpen={showEdit}
          onClose={() => setShowEdit(false)}
          title={`Editar: ${editTarget?.nome ?? ''}`}
          size="lg"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-foreground mb-1">
                  Nome <span className="text-destructive">*</span>
                </label>
                <input
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={editForm.nome}
                  onChange={e => setEditForm(f => f && { ...f, nome: e.target.value })}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">CNPJ</label>
                <input
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={editForm.cnpj}
                  onChange={e => setEditForm(f => f && { ...f, cnpj: maskCnpj(e.target.value) })}
                  placeholder="00.000.000/0001-00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Plano</label>
                <select
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={editForm.plano}
                  onChange={e => setEditForm(f => f && { ...f, plano: e.target.value as PlanoTenant })}
                >
                  {PLANOS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            </div>

            {/* Diretor section */}
            <div className="border-t border-border pt-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Diretor Designado (Opcional)
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Nome</label>
                  <input
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={editForm.diretorNome}
                    onChange={e => setEditForm(f => f && { ...f, diretorNome: e.target.value })}
                    placeholder="João da Silva"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Cargo</label>
                  <input
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={editForm.diretorCargo}
                    onChange={e => setEditForm(f => f && { ...f, diretorCargo: e.target.value })}
                    placeholder="Diretor Financeiro"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">E-mail</label>
                  <input
                    type="email"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={editForm.diretorEmail}
                    onChange={e => setEditForm(f => f && { ...f, diretorEmail: e.target.value })}
                    placeholder="joao@empresa.com.br"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Designado em</label>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={editForm.diretorDesignadoEm}
                    onChange={e => setEditForm(f => f && { ...f, diretorDesignadoEm: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowEdit(false)}
                className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted text-muted-foreground transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleEdit()}
                disabled={saving || !editForm.nome.trim()}
                className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-50"
              >
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Page content ────────────────────────────────────────────────── */}
      <div className="p-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <StorefrontIcon size={20} weight="duotone" className="text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Tenants</h1>
              <p className="text-sm text-muted-foreground">Gerenciamento de organizações</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load(page)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-input hover:bg-muted text-muted-foreground transition-colors"
            >
              <ArrowClockwiseIcon size={14} />
              Atualizar
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
            >
              <PlusIcon size={14} weight="bold" />
              Novo Tenant
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total', value: total },
            { label: 'Ativos', value: ativos },
            { label: 'Suspensos', value: suspensos },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <MagnifyingGlassIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full max-w-sm rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Buscar por nome, slug ou CNPJ…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Carregando…</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              {search ? 'Nenhum tenant encontrado para a busca.' : 'Nenhum tenant cadastrado.'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>CNPJ</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Usuários</TableHead>
                  <TableHead className="text-right">Contratos</TableHead>
                  <TableHead>Criado em</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(t => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="font-medium text-foreground leading-tight">{t.nome}</div>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">{t.slug}</div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-mono text-muted-foreground">{t.cnpj ?? '—'}</span>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${PLANO_BADGE[t.plano]}`}>
                        {planoLabel(t.plano)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {t.ativo ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                          Ativo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                          Suspenso
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {t._count?.usuarios ?? '—'}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {t._count?.contratos ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {fmtDate(t.criadoEm)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          type="button"
                          onClick={() => openEdit(t)}
                          title="Editar"
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        >
                          <PencilSimpleIcon size={14} />
                        </button>
                        {t.ativo ? (
                          <button
                            type="button"
                            onClick={() => setConfirmSuspend(t)}
                            title="Suspender"
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"
                          >
                            <ProhibitIcon size={14} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmReativar(t)}
                            title="Reativar"
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-green-50 hover:text-green-600 transition-colors"
                          >
                            <CheckCircleIcon size={14} />
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {meta.total} tenant{meta.total !== 1 ? 's' : ''} · página {meta.page} de {meta.totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={meta.page <= 1}
                className="px-3 py-1.5 rounded-lg border border-input text-xs hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Anterior
              </button>
              <button
                type="button"
                onClick={() => setPage(p => Math.min(meta.totalPages, p + 1))}
                disabled={meta.page >= meta.totalPages}
                className="px-3 py-1.5 rounded-lg border border-input text-xs hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
