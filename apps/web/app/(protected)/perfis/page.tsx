'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { ArrowClockwise, ShieldCheck, Users, UserMinus, Plus, PencilSimple, Trash, Lock, MagnifyingGlass } from '@phosphor-icons/react';
import { Modal } from '@/components/ui/modal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast, ToastContainer } from '@/components/ui/toast';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { getSessionUser } from '@/lib/session';

type Role = 'ADMIN' | 'GESTOR' | 'RESP' | 'AUD_INT' | 'AUD_EXT' | 'EXEC';

interface Perfil {
  id: string;
  nome: string;
  descricao?: string;
  role: string;
  permissoes?: string[];
  ativo?: boolean;
  _count?: { usuarios: number };
}

interface UsuarioPerfil {
  usuarioId: string;
  usuario?: { id: string; nome: string; email: string; role: string };
}

interface UsuarioItem {
  id: string;
  nome: string;
  email: string;
  role: string;
  ativo: boolean;
}

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'ADMIN', label: 'Administrador' },
  { value: 'GESTOR', label: 'Gestor' },
  { value: 'RESP', label: 'Responsável' },
  { value: 'AUD_INT', label: 'Auditor Interno' },
  { value: 'AUD_EXT', label: 'Auditor Externo' },
  { value: 'EXEC', label: 'Executivo' },
];

const ROLE_META: Record<string, { label: string; color: string; badgeCls: string; leftBorder: string; selectedBg: string }> = {
  ADMIN:   { label: 'Administrador',   color: 'bg-red-50 text-red-600',         badgeCls: 'bg-red-100 text-red-700',       leftBorder: 'border-red-400',     selectedBg: 'bg-red-50'    },
  GESTOR:  { label: 'Gestor',          color: 'bg-primary/10 text-primary',     badgeCls: 'bg-primary/10 text-primary',    leftBorder: 'border-primary',     selectedBg: 'bg-primary/10'},
  RESP:    { label: 'Responsável',     color: 'bg-violet-50 text-violet-600',   badgeCls: 'bg-violet-100 text-violet-700', leftBorder: 'border-violet-400',  selectedBg: 'bg-violet-50' },
  AUD_INT: { label: 'Auditor Interno', color: 'bg-amber-50 text-amber-600',     badgeCls: 'bg-amber-100 text-amber-700',   leftBorder: 'border-amber-400',   selectedBg: 'bg-amber-50'  },
  AUD_EXT: { label: 'Auditor Externo', color: 'bg-muted text-muted-foreground',     badgeCls: 'bg-muted text-muted-foreground',   leftBorder: 'border-input',   selectedBg: 'bg-muted' },
  EXEC:    { label: 'Executivo',       color: 'bg-emerald-50 text-emerald-600', badgeCls: 'bg-emerald-100 text-emerald-700', leftBorder: 'border-emerald-400', selectedBg: 'bg-emerald-50'},
};

type ModalMode = 'criar' | 'editar' | 'atribuir' | null;

const PERMISSION_GROUPS = [
  { group: 'Dashboard',    module: 'dashboard',    label: 'Dashboard',    permissions: [{ key: 'dashboard.view', label: 'Visualizar' }] },
  { group: 'Usuários',     module: 'usuarios',     label: 'Usuários',     permissions: [{ key: 'usuarios.view', label: 'Visualizar' }, { key: 'usuarios.create', label: 'Criar' }, { key: 'usuarios.edit', label: 'Editar' }, { key: 'usuarios.delete', label: 'Excluir/Inativar' }] },
  { group: 'Perfis',       module: 'perfis',       label: 'Perfis',       permissions: [{ key: 'perfis.view', label: 'Visualizar' }, { key: 'perfis.create', label: 'Criar' }, { key: 'perfis.edit', label: 'Editar' }, { key: 'perfis.delete', label: 'Excluir' }] },
  { group: 'Fornecedores', module: 'fornecedores', label: 'Fornecedores', permissions: [{ key: 'fornecedores.view', label: 'Visualizar' }, { key: 'fornecedores.create', label: 'Criar' }, { key: 'fornecedores.edit', label: 'Editar' }, { key: 'fornecedores.inativar', label: 'Inativar' }] },
  { group: 'Empresas',     module: 'empresas',     label: 'Empresas',     permissions: [{ key: 'empresas.view', label: 'Visualizar' }, { key: 'empresas.create', label: 'Criar' }, { key: 'empresas.edit', label: 'Editar' }, { key: 'empresas.delete', label: 'Excluir' }] },
  { group: 'Certificados', module: 'certificados', label: 'Certificados', permissions: [{ key: 'certificados.view', label: 'Visualizar' }, { key: 'certificados.create', label: 'Fazer upload' }, { key: 'certificados.delete', label: 'Revogar' }] },
  { group: 'Unidades',     module: 'unidades',     label: 'Unidades',     permissions: [{ key: 'unidades.view', label: 'Visualizar' }, { key: 'unidades.create', label: 'Criar' }, { key: 'unidades.edit', label: 'Editar' }] },
  { group: 'DFe / NF-e',  module: 'dfe',          label: 'DFe / NF-e',  permissions: [{ key: 'dfe.view', label: 'Visualizar' }, { key: 'dfe.manage', label: 'Gerenciar' }] },
  { group: 'Etiquetas',    module: 'etiquetas',    label: 'Etiquetas',    permissions: [{ key: 'etiquetas.view', label: 'Visualizar' }, { key: 'etiquetas.create', label: 'Criar' }, { key: 'etiquetas.edit', label: 'Editar' }, { key: 'etiquetas.delete', label: 'Excluir' }] },
  { group: 'Auditoria',    module: 'auditoria',    label: 'Auditoria',    permissions: [{ key: 'auditoria.view', label: 'Visualizar' }] },
  { group: 'Relatórios',   module: 'relatorios',   label: 'Relatórios',   permissions: [{ key: 'relatorios.view', label: 'Visualizar' }] },
  { group: 'Obrigações Acessórias', module: 'obrigacoes', label: 'Obrigações Acessórias', permissions: [{ key: 'obrigacoes-acessorias.view', label: 'Visualizar / Upload' }] },
  { group: 'Análise de Crédito',   module: 'analise-credito', label: 'Análise de Crédito', permissions: [{ key: 'analise-credito.view', label: 'Visualizar' }, { key: 'analise-credito.processar', label: 'Processar pipeline' }] },
];


interface PermissoesPanelProps {
  perfil: Perfil;
  isAdmin: boolean;
  saving: boolean;
  onSave: (perms: string[]) => Promise<void>;
}

function PermissoesPanel({ perfil, isAdmin, saving, onSave }: PermissoesPanelProps) {
  const [draft, setDraft] = useState<string[]>(() => perfil.permissoes ?? []);
  const [filterModulo, setFilterModulo] = useState('');

  const totalPerms = PERMISSION_GROUPS.flatMap((g) => g.permissions).length;
  const visibleGroups = filterModulo ? PERMISSION_GROUPS.filter((g) => g.module === filterModulo) : PERMISSION_GROUPS;

  const isDirty = useMemo(() => {
    const a = [...draft].sort();
    const b = [...(perfil.permissoes ?? [])].sort();
    if (a.length !== b.length) return true;
    return a.some((v, i) => v !== b[i]);
  }, [draft, perfil.permissoes]);

  const toggle = (key: string) => setDraft((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);

  return (
    <div className="rounded-lg border border-input shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between bg-card">
        <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
          <Lock size={13} className="text-muted-foreground" />
          Permissões
          <span className="text-xs font-normal text-muted-foreground">({draft.length}/{totalPerms})</span>
        </span>
        {isAdmin && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button type="button" onClick={() => setDraft(PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key)))} className="text-xs text-primary hover:underline">
              Selecionar Tudo
            </button>
            <span className="text-muted-foreground/30">|</span>
            <button type="button" onClick={() => setDraft([])} className="text-xs text-muted-foreground hover:underline">
              Desmarcar Tudo
            </button>
            <span className="text-muted-foreground/30">|</span>
            <button
              type="button"
              disabled={!isDirty || saving}
              onClick={() => void onSave(draft)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" /> : null}
              Salvar Alterações
            </button>
          </div>
        )}
      </div>

      <div className="px-4 py-2 border-b border-border bg-card">
        <select
          value={filterModulo}
          onChange={(e) => setFilterModulo(e.target.value)}
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
        >
          <option value="">Todos os módulos</option>
          {PERMISSION_GROUPS.map((g) => {
            const sel = g.permissions.filter((p) => draft.includes(p.key)).length;
            return <option key={g.module} value={g.module}>{g.label} — {sel}/{g.permissions.length} selecionada(s)</option>;
          })}
        </select>
      </div>

      <div>
        {visibleGroups.map((group) => {
          const groupKeys = group.permissions.map((p) => p.key);
          const groupKeySet = new Set(groupKeys);
          return (
            <div key={group.module} className="border-b border-border last:border-0">
              <div className="flex items-center justify-between px-4 py-2.5 bg-muted">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{group.label}</span>
                {isAdmin && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setDraft((prev) => [...new Set([...prev, ...groupKeys])])} className="text-xs text-primary hover:underline">Tudo</button>
                    <span className="text-muted-foreground/30">|</span>
                    <button type="button" onClick={() => setDraft((prev) => prev.filter((k) => !groupKeySet.has(k)))} className="text-xs text-muted-foreground hover:underline">Nenhum</button>
                  </div>
                )}
              </div>
              <div>
                {group.permissions.map((perm) => {
                  const checked = draft.includes(perm.key);
                  return (
                    <div
                      key={perm.key}
                      role="checkbox"
                      aria-checked={checked}
                      tabIndex={isAdmin ? 0 : -1}
                      onClick={() => { if (isAdmin) toggle(perm.key); }}
                      onKeyDown={(e) => { if (isAdmin && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); toggle(perm.key); } }}
                      className={`flex items-center gap-3 px-4 py-2.5 border-b border-border/20 last:border-0 select-none transition-colors ${isAdmin ? 'cursor-pointer hover:bg-muted' : 'cursor-default'}`}
                    >
                      <span className={`h-4 w-4 shrink-0 rounded flex items-center justify-center border transition-colors ${checked ? 'bg-primary border-primary' : 'border-input bg-card'}`}>
                        {checked && (
                          <svg viewBox="0 0 10 8" className="w-2.5 h-2 text-white" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="1,4 4,7 9,1" />
                          </svg>
                        )}
                      </span>
                      <span className={`text-sm ${checked ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{perm.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function PerfisPage() {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const u = getSessionUser();
    setIsAdmin(u?.role === 'ADMIN');
  }, []);

  const { toasts, success, error: toastError, dismiss } = useToast();

  const [perfis, setPerfis] = useState<Perfil[]>([]);
  const [loadingPerfis, setLoadingPerfis] = useState(true);
  const [selectedPerfil, setSelectedPerfil] = useState<Perfil | null>(null);
  const [membros, setMembros] = useState<UsuarioPerfil[]>([]);
  const [loadingMembros, setLoadingMembros] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [saving, setSaving] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Perfil | null>(null);
  const [formNome, setFormNome] = useState('');
  const [formDescricao, setFormDescricao] = useState('');
  const [formRole, setFormRole] = useState<string>('RESP');
  const [formPerms, setFormPerms] = useState<string[]>([]);
  const [atribuirUsuarioId, setAtribuirUsuarioId] = useState('');
  const [usuarios, setUsuarios] = useState<UsuarioItem[]>([]);
  const [savingPerms, setSavingPerms] = useState(false);
  const [searchPerfis, setSearchPerfis] = useState('');

  const loadPerfis = useCallback(async () => {
    setLoadingPerfis(true);
    try {
      const res = await api.get('/perfis');
      setPerfis(res.data?.data ?? res.data ?? []);
    } catch {
      toastError('Erro ao carregar perfis.');
    } finally {
      setLoadingPerfis(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadUsuarios = useCallback(async () => {
    try {
      const res = await api.get('/usuarios?limit=500');
      const d = res.data;
      setUsuarios(d.data ?? d ?? []);
    } catch { /* silent */ }
  }, []);

  const loadMembros = useCallback(async (perfilId: string) => {
    setLoadingMembros(true);
    try {
      const res = await api.get(`/perfis/${perfilId}/usuarios`);
      setMembros(res.data?.data ?? res.data ?? []);
    } catch {
      toastError('Erro ao carregar membros.');
    } finally {
      setLoadingMembros(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadPerfis();
    void loadUsuarios();
  }, [loadPerfis, loadUsuarios]);

  const selectPerfil = (p: Perfil) => {
    if (selectedPerfil?.id === p.id) { setSelectedPerfil(null); setMembros([]); }
    else { setSelectedPerfil(p); void loadMembros(p.id); }
  };

  const openCriar = () => {
    setFormNome(''); setFormDescricao(''); setFormRole('RESP'); setFormPerms([]);
    setModalMode('criar');
  };

  const openEditar = (p: Perfil, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedPerfil(p);
    setFormNome(p.nome);
    setFormDescricao(p.descricao ?? '');
    setFormRole(p.role);
    setFormPerms(p.permissoes ?? []);
    setModalMode('editar');
  };

  const handleSalvarPerfil = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formNome.trim()) return;
    setSaving(true);
    try {
      if (modalMode === 'criar') {
        await api.post('/perfis', { nome: formNome.trim(), descricao: formDescricao.trim() || undefined, role: formRole, permissoes: formPerms });
        success('Perfil criado com sucesso!');
      } else if (modalMode === 'editar' && selectedPerfil) {
        await api.patch(`/perfis/${selectedPerfil.id}`, { nome: formNome.trim(), descricao: formDescricao.trim() || undefined, role: formRole, permissoes: formPerms });
        success('Perfil atualizado!');
        setSelectedPerfil(null);
      }
      setModalMode(null);
      void loadPerfis();
    } catch {
      toastError(modalMode === 'criar' ? 'Erro ao criar perfil.' : 'Erro ao atualizar perfil.');
    } finally {
      setSaving(false);
    }
  };

  const handleSalvarPermissoes = async (perms: string[]) => {
    if (!selectedPerfil) return;
    setSavingPerms(true);
    try {
      await api.patch(`/perfis/${selectedPerfil.id}`, { permissoes: perms });
      const updated = { ...selectedPerfil, permissoes: perms };
      setSelectedPerfil(updated);
      setPerfis((prev) => prev.map((p) => p.id === selectedPerfil.id ? { ...p, permissoes: perms } : p));
      success('Permissões salvas!');
    } catch {
      toastError('Erro ao salvar permissões.');
    } finally {
      setSavingPerms(false);
    }
  };

  const handleRemoverPerfil = async () => {
    if (!removeTarget) return;
    try {
      await api.delete(`/perfis/${removeTarget.id}`);
      success('Perfil removido.');
      if (selectedPerfil?.id === removeTarget.id) { setSelectedPerfil(null); setMembros([]); }
      setRemoveTarget(null);
      void loadPerfis();
    } catch {
      toastError('Erro ao remover perfil. Verifique se há usuários associados.');
    }
  };

  const handleAtribuir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPerfil || !atribuirUsuarioId) return;
    setSaving(true);
    try {
      await api.post(`/perfis/${selectedPerfil.id}/usuarios`, { usuarioId: atribuirUsuarioId });
      success('Usuário adicionado ao perfil!');
      setAtribuirUsuarioId(''); setModalMode(null);
      void loadMembros(selectedPerfil.id);
      void loadPerfis();
    } catch {
      toastError('Erro ao adicionar usuário ao perfil.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoverMembro = async (usuarioId: string) => {
    if (!selectedPerfil) return;
    try {
      await api.delete(`/perfis/${selectedPerfil.id}/usuarios/${usuarioId}`);
      success('Usuário removido do perfil.');
      void loadMembros(selectedPerfil.id);
      void loadPerfis();
    } catch {
      toastError('Erro ao remover usuário do perfil.');
    }
  };

  const membrosIds = useMemo(() => new Set(membros.map((m) => m.usuarioId)), [membros]);
  const usuariosDisponiveis = useMemo(
    () => usuarios.filter((u) => u.ativo && !membrosIds.has(u.id)),
    [usuarios, membrosIds],
  );
  const filteredPerfis = useMemo(() => {
    const q = searchPerfis.toLowerCase();
    return q ? perfis.filter((p) => p.nome.toLowerCase().includes(q) || (p.descricao ?? '').toLowerCase().includes(q)) : perfis;
  }, [perfis, searchPerfis]);

  const selectedMeta = selectedPerfil ? ROLE_META[selectedPerfil.role] ?? null : null;
  const selectCls = 'w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors';

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Perfis de Acesso</h1>
          <p className="text-sm text-muted-foreground mt-1">Crie perfis customizados e associe usuários a eles.</p>
        </div>
        <button type="button" onClick={() => void loadPerfis()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors">
          <ArrowClockwise size={15} />
        </button>
      </div>

      {/* Two panels */}
      <div className="flex-1 min-h-0 flex rounded-lg border border-input shadow-sm bg-card overflow-hidden">

        {/* Left panel */}
        <div className="w-72 shrink-0 flex flex-col border-r border-input bg-muted/40 overflow-hidden">
          <div className="shrink-0 p-3 border-b border-border space-y-2">
            <div className="relative">
              <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchPerfis}
                onChange={(e) => setSearchPerfis(e.target.value)}
                placeholder="Pesquisar perfil..."
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-input text-sm text-foreground placeholder-slate-400 bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
              />
            </div>
            <p className="text-xs text-muted-foreground px-1">{filteredPerfis.length} de {perfis.length} perfil(is)</p>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loadingPerfis && ['a', 'b', 'c'].map((k) => (
              <div key={k} className="h-16 rounded-lg bg-muted animate-pulse mx-1" />
            ))}
            {!loadingPerfis && filteredPerfis.length === 0 && (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm gap-2">
                <ShieldCheck size={28} className="opacity-20" />
                {searchPerfis ? 'Nenhum perfil encontrado.' : 'Nenhum perfil criado.'}
              </div>
            )}
            {!loadingPerfis && filteredPerfis.map((p) => {
              const meta = ROLE_META[p.role];
              const isSelected = selectedPerfil?.id === p.id;
              return (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectPerfil(p)}
                  onKeyDown={(e) => e.key === 'Enter' && selectPerfil(p)}
                  className={`group w-full text-left rounded-lg border-l-4 p-3.5 transition-all cursor-pointer ${
                    isSelected
                      ? `${meta?.leftBorder ?? 'border-primary'} ${meta?.selectedBg ?? 'bg-orange-50'}`
                      : 'border-l-transparent bg-card hover:bg-muted'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${meta?.color ?? 'bg-muted text-muted-foreground'}`}>
                      <ShieldCheck size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-foreground text-sm truncate">{p.nome}</span>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${meta?.badgeCls ?? 'bg-muted text-muted-foreground'}`}>
                          {meta?.label ?? p.role}
                        </span>
                      </div>
                      {p.descricao && <p className="text-xs text-muted-foreground truncate mt-0.5">{p.descricao}</p>}
                      <div className="flex items-center gap-1 mt-1.5">
                        <Users size={10} className="text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">{p._count?.usuarios ?? 0} membro(s)</span>
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button type="button" onClick={(e) => openEditar(p, e)} className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors" title="Editar">
                          <PencilSimple size={12} />
                        </button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setRemoveTarget(p); }} className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors" title="Remover">
                          <Trash size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {isAdmin && (
            <div className="shrink-0 p-3 border-t border-border">
              <button
                type="button"
                onClick={openCriar}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed border-input text-sm text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5 transition-colors"
              >
                <Plus size={14} /> Novo Perfil
              </button>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="flex-1 overflow-y-auto">
          {!selectedPerfil ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
              <ShieldCheck size={48} className="opacity-10" />
              <div className="text-center">
                <p className="text-sm font-medium text-muted-foreground">Selecione um perfil</p>
                <p className="text-xs text-muted-foreground mt-1">Clique em um perfil para ver membros e permissões</p>
              </div>
            </div>
          ) : (
            <div>
              <div className="px-6 py-5 border-b border-border flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${selectedMeta?.color ?? 'bg-muted text-muted-foreground'}`}>
                    <ShieldCheck size={20} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-foreground">{selectedPerfil.nome}</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">Gerencie membros e permissões deste perfil.</p>
                  </div>
                </div>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full shrink-0 mt-1 ${selectedMeta?.badgeCls ?? 'bg-muted text-muted-foreground'}`}>
                  {selectedMeta?.label ?? selectedPerfil.role}
                </span>
              </div>

              <div className="p-6 space-y-6">
                {/* Membros */}
                <div className="rounded-lg border border-input shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${selectedMeta?.color ?? 'bg-muted'}`}>
                        <Users size={15} />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">Membros</h3>
                        <p className="text-xs text-muted-foreground">{membros.length} membro(s)</p>
                      </div>
                    </div>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => { setAtribuirUsuarioId(''); setModalMode('atribuir'); }}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-input text-foreground text-xs font-medium hover:bg-muted transition-colors"
                      >
                        <Plus size={13} /> Adicionar
                      </button>
                    )}
                  </div>
                  <div className="p-5">
                    {loadingMembros && (
                      <div className="flex gap-4">
                        {['a', 'b', 'c'].map((k) => (
                          <div key={k} className="flex flex-col items-center gap-2">
                            <div className="h-12 w-12 rounded-full bg-muted animate-pulse" />
                            <div className="h-3 w-14 rounded bg-muted animate-pulse" />
                          </div>
                        ))}
                      </div>
                    )}
                    {!loadingMembros && membros.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-6 text-muted-foreground gap-2">
                        <UserMinus size={24} className="opacity-30" />
                        <p className="text-sm">Nenhum membro neste perfil.</p>
                      </div>
                    )}
                    {!loadingMembros && membros.length > 0 && (
                      <div className="flex flex-wrap gap-5">
                        {membros.map((m) => {
                          const u = m.usuario;
                          if (!u) return null;
                          const meta = ROLE_META[u.role];
                          return (
                            <div key={m.usuarioId} className="relative group flex flex-col items-center gap-1.5">
                              <div className={`relative h-12 w-12 rounded-full flex items-center justify-center font-bold text-base ring-2 ring-white shadow-sm ${meta?.color ?? 'bg-muted text-muted-foreground'}`}>
                                {u.nome.charAt(0).toUpperCase()}
                                {isAdmin && (
                                  <button
                                    type="button"
                                    onClick={() => void handleRemoverMembro(m.usuarioId)}
                                    className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow"
                                    title="Remover do perfil"
                                  >
                                    <UserMinus size={9} />
                                  </button>
                                )}
                              </div>
                              <div className="text-center">
                                <p className="text-xs font-medium text-foreground leading-tight max-w-[72px] truncate">{u.nome.split(' ')[0]}</p>
                                <p className="text-[10px] text-muted-foreground leading-tight">{meta?.label ?? u.role}</p>
                              </div>
                            </div>
                          );
                        })}
                        {isAdmin && (
                          <div className="flex flex-col items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => { setAtribuirUsuarioId(''); setModalMode('atribuir'); }}
                              className="h-12 w-12 rounded-full border-2 border-dashed border-input flex items-center justify-center text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5 transition-colors"
                            >
                              <Plus size={16} />
                            </button>
                            <p className="text-[10px] text-muted-foreground">Adicionar</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Permissões */}
                <PermissoesPanel
                  key={selectedPerfil.id}
                  perfil={selectedPerfil}
                  isAdmin={isAdmin}
                  saving={savingPerms}
                  onSave={handleSalvarPermissoes}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal criar / editar */}
      <Modal
        isOpen={modalMode === 'criar' || modalMode === 'editar'}
        onClose={() => setModalMode(null)}
        title={modalMode === 'criar' ? 'Criar Perfil' : 'Editar Perfil'}
        size="2xl"
      >
        <form onSubmit={(e) => void handleSalvarPerfil(e)}>
          {/* Identificação */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="col-span-2">
              <label htmlFor="pf-nome" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5.5">Nome do Perfil <span className="text-red-400">*</span></label>
              <Input id="pf-nome" value={formNome} onChange={(e) => setFormNome(e.target.value)} placeholder="Ex: Auditores de Contrato" required />
            </div>
            <div>
              <label htmlFor="pf-role" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5.5">Nível de acesso <span className="text-red-400">*</span></label>
              <select id="pf-role" value={formRole} onChange={(e) => setFormRole(e.target.value)} className={selectCls}>
                {ROLE_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
            </div>
          </div>

          {/* Badge de papel selecionado */}
          {(() => {
            const meta = ROLE_META[formRole];
            return meta ? (
              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium mb-4 ${meta.badgeCls}`}>
                <ShieldCheck size={13} />
                {meta.label} — nível selecionado
              </div>
            ) : null;
          })()}

          <div className="mb-5">
            <label htmlFor="pf-descricao" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5.5">
              Descrição <span className="text-muted-foreground font-normal">(opcional)</span>
            </label>
            <textarea
              id="pf-descricao"
              value={formDescricao}
              onChange={(e) => setFormDescricao(e.target.value)}
              rows={2}
              placeholder="Breve descrição sobre o propósito e escopo deste perfil"
              className="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors resize-none"
            />
          </div>

          {/* Permissões */}
          <div className="rounded-lg border border-input overflow-hidden mb-5">
            <div className="flex items-center justify-between px-4 py-3 bg-muted border-b border-input">
              <div className="flex items-center gap-2">
                <Lock size={13} className="text-muted-foreground" />
                <span className="text-sm font-semibold text-foreground">Permissões</span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${formPerms.length > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                  {formPerms.length}/{PERMISSION_GROUPS.flatMap((g) => g.permissions).length}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setFormPerms(PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key)))} className="text-xs font-medium text-primary hover:text-primary/70 transition-colors">Marcar todas</button>
                <span className="text-muted-foreground/30 select-none">|</span>
                <button type="button" onClick={() => setFormPerms([])} className="text-xs text-muted-foreground hover:text-muted-foreground transition-colors">Desmarcar todas</button>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
              {PERMISSION_GROUPS.map((group) => {
                const groupKeys = group.permissions.map((p) => p.key);
                const checkedCount = groupKeys.filter((k) => formPerms.includes(k)).length;
                const allChecked = checkedCount === groupKeys.length;
                return (
                  <div key={group.module}>
                    <div className="flex items-center justify-between px-4 py-2 bg-muted/80">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{group.label}</span>
                        {checkedCount > 0 && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${allChecked ? 'bg-primary/10 text-primary' : 'bg-amber-100 text-amber-700'}`}>
                            {checkedCount}/{groupKeys.length}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setFormPerms((prev) => [...new Set([...prev, ...groupKeys])])} className="text-xs font-medium text-primary hover:text-primary/70 transition-colors">Tudo</button>
                        <span className="text-muted-foreground/30 select-none">|</span>
                        <button type="button" onClick={() => setFormPerms((prev) => prev.filter((k) => !groupKeys.includes(k)))} className="text-xs text-muted-foreground hover:text-muted-foreground transition-colors">Nenhum</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-0 px-2 py-1">
                      {group.permissions.map((perm) => {
                        const isChecked = formPerms.includes(perm.key);
                        return (
                          <label key={perm.key} className="flex items-center gap-2.5 px-2 py-2 rounded-lg cursor-pointer select-none hover:bg-muted transition-colors group">
                            <span className={`h-4 w-4 shrink-0 rounded flex items-center justify-center border transition-all ${isChecked ? 'bg-primary border-primary shadow-sm' : 'border-input bg-card group-hover:border-primary/50'}`}>
                              {isChecked && (
                                <svg viewBox="0 0 10 8" className="w-2.5 h-2 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="1,4 4,7 9,1" />
                                </svg>
                              )}
                            </span>
                            <input type="checkbox" checked={isChecked} onChange={() => setFormPerms((prev) => prev.includes(perm.key) ? prev.filter((k) => k !== perm.key) : [...prev, perm.key])} className="sr-only" />
                            <span className={`text-sm transition-colors ${isChecked ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{perm.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <button type="button" onClick={() => setModalMode(null)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 shadow-sm">
              {saving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <ShieldCheck size={15} />}
              {modalMode === 'criar' ? 'Criar Perfil' : 'Salvar Alterações'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal atribuir usuário */}
      <Modal isOpen={modalMode === 'atribuir'} onClose={() => setModalMode(null)} title={`Adicionar Usuário — ${selectedPerfil?.nome ?? ''}`} size="sm">
        <form onSubmit={(e) => void handleAtribuir(e)} className="space-y-4">
          <div>
            <label htmlFor="atribuir-usuario" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Usuário *</label>
            <select id="atribuir-usuario" value={atribuirUsuarioId} onChange={(e) => setAtribuirUsuarioId(e.target.value)} className={selectCls}>
              <option value="">Selecione um usuário...</option>
              {usuariosDisponiveis.map((u) => (
                <option key={u.id} value={u.id}>{u.nome} ({ROLE_META[u.role]?.label ?? u.role})</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-border">
            <button type="button" onClick={() => setModalMode(null)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors">Cancelar</button>
            <button type="submit" disabled={saving || !atribuirUsuarioId} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
              {saving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : null}
              Adicionar
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!removeTarget}
        title="Remover Perfil"
        message={`Tem certeza que deseja remover o perfil "${removeTarget?.nome}"? Usuários associados serão desvinculados.`}
        confirmLabel="Sim, remover"
        onConfirm={() => void handleRemoverPerfil()}
        onCancel={() => setRemoveTarget(null)}
      />

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
