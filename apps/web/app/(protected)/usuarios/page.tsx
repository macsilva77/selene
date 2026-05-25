'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { PlusIcon, ArrowClockwiseIcon, UserMinusIcon, UserPlusIcon, PencilSimpleIcon, TrashIcon, ClockIcon } from '@phosphor-icons/react';
import { Pagination } from '@/components/ui/pagination';
import { ActionsMenu } from '@/components/ui/actions-menu';
import { DataTable } from '@/components/ui/table';
import { Modal } from '@/components/ui/modal';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast, ToastContainer } from '@/components/ui/toast';
import { api } from '@/lib/api';

const PAGE_SIZE = 10;

type Role = 'ADMIN' | 'GESTOR' | 'RESP' | 'AUD_INT' | 'AUD_EXT' | 'EXEC';

interface Usuario {
  id: string;
  nome: string;
  email: string;
  role: Role;
  perfilId?: string | null;
  ativo: boolean;
  criadoEm: string;
  aguardandoAtivacao?: boolean;
  cpf?: string;
  telefone?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
}

interface Perfil { id: string; nome: string; role: string; }

const ROLE_BADGE_CLS: Record<Role, string> = {
  ADMIN:   'bg-red-100 text-red-700',
  EXEC:    'bg-amber-100 text-amber-700',
  GESTOR:  'bg-primary/10 text-primary',
  RESP:    'bg-primary/10 text-primary',
  AUD_INT: 'bg-muted text-muted-foreground',
  AUD_EXT: 'bg-muted text-muted-foreground',
};


interface NovoUsuarioForm {
  nome: string; email: string; perfilId: string;
  cpf: string; telefone: string; cep: string; logradouro: string;
  numero: string; complemento: string; bairro: string; municipio: string; uf: string;
}

interface EditUsuarioForm {
  nome: string; email: string; perfilId: string; novaSenha: string;
  cpf: string; telefone: string; cep: string; logradouro: string;
  numero: string; complemento: string; bairro: string; municipio: string; uf: string;
}

const FORM_INITIAL: NovoUsuarioForm = {
  nome: '', email: '', perfilId: '',
  cpf: '', telefone: '', cep: '', logradouro: '', numero: '',
  complemento: '', bairro: '', municipio: '', uf: '',
};

const EDIT_INITIAL: EditUsuarioForm = {
  nome: '', email: '', perfilId: '', novaSenha: '',
  cpf: '', telefone: '', cep: '', logradouro: '', numero: '',
  complemento: '', bairro: '', municipio: '', uf: '',
};

function getUser() {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(localStorage.getItem('selene_usuario') ?? 'null'); } catch { return null; }
}

export default function UsuariosPage() {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const u = getUser();
    setIsAdmin(u?.role === 'ADMIN');
  }, []);

  const { toasts, success, error: toastError, dismiss } = useToast();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [inativarTarget, setInativarTarget] = useState<Usuario | null>(null);
  const [excluirTarget, setExcluirTarget] = useState<Usuario | null>(null);
  const [reativarTarget, setReativarTarget] = useState<Usuario | null>(null);
  const [form, setForm] = useState<NovoUsuarioForm>(FORM_INITIAL);
  const [saving, setSaving] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);

  const [editTarget, setEditTarget] = useState<Usuario | null>(null);
  const [editForm, setEditForm] = useState<EditUsuarioForm>(EDIT_INITIAL);
  const [editSaving, setEditSaving] = useState(false);
  const [perfis, setPerfis] = useState<Perfil[]>([]);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filterPerfilId, setFilterPerfilId] = useState('');
  const [filterAtivo, setFilterAtivo] = useState<'' | 'true' | 'false' | 'pendente'>('');

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get('/auth/usuarios?limit=500');
      const d = res.data;
      setUsuarios(d.data ?? d ?? []);
    } catch {
      toastError('Erro ao carregar usuários.');
    } finally {
      setIsLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    api.get('/perfis/ativos').then((r) => setPerfis(r.data ?? [])).catch(() => {});
  }, []);

  const filteredUsuarios = useMemo(() => {
    const q = search.toLowerCase();
    return usuarios.filter((u) => {
      if (q && !u.nome.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false;
      if (filterPerfilId && u.perfilId !== filterPerfilId) return false;
      if (filterAtivo === 'pendente') { if (!u.aguardandoAtivacao) return false; }
      else if (filterAtivo !== '' && String(u.ativo) !== filterAtivo) return false;
      return true;
    });
  }, [usuarios, search, filterPerfilId, filterAtivo]);

  const totalPages = Math.max(1, Math.ceil(filteredUsuarios.length / PAGE_SIZE));
  const pagedUsuarios = filteredUsuarios.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [search, filterPerfilId, filterAtivo]);

  const fetchCepData = useCallback(async (cep: string) => {
    const cleaned = cep.replaceAll(/\D/g, '');
    if (cleaned.length !== 8) return null;
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cep/v1/${cleaned}`);
      if (!res.ok) return null;
      return res.json() as Promise<{ street?: string; neighborhood?: string; city?: string; state?: string }>;
    } catch { return null; }
  }, []);

  const buscarCep = useCallback(async (cep: string) => {
    setCepLoading(true);
    try {
      const d = await fetchCepData(cep);
      if (!d) return;
      setForm((f) => ({
        ...f,
        logradouro: d.street ?? f.logradouro,
        bairro: d.neighborhood ?? f.bairro,
        municipio: d.city ?? f.municipio,
        uf: d.state ?? f.uf,
      }));
    } finally { setCepLoading(false); }
  }, [fetchCepData]);

  const buscarCepEdit = useCallback(async (cep: string) => {
    setCepLoading(true);
    try {
      const d = await fetchCepData(cep);
      if (!d) return;
      setEditForm((f) => ({
        ...f,
        logradouro: d.street ?? f.logradouro,
        bairro: d.neighborhood ?? f.bairro,
        municipio: d.city ?? f.municipio,
        uf: d.state ?? f.uf,
      }));
    } finally { setCepLoading(false); }
  }, [fetchCepData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/auth/usuarios', {
        nome: form.nome, email: form.email, perfilId: form.perfilId,
        cpf: form.cpf || undefined, telefone: form.telefone || undefined,
        cep: form.cep || undefined, logradouro: form.logradouro || undefined,
        numero: form.numero || undefined, complemento: form.complemento || undefined,
        bairro: form.bairro || undefined, municipio: form.municipio || undefined,
        uf: form.uf || undefined,
      });
      success('Usuário criado! Um e-mail foi enviado para ele criar a senha.');
      setShowForm(false);
      setForm(FORM_INITIAL);
      void load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data;
      const detail = msg?.errors?.join(', ') ?? msg?.message ?? 'Erro ao criar usuário.';
      toastError(detail);
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (u: Usuario) => {
    setEditTarget(u);
    setEditForm({
      nome: u.nome, email: u.email, perfilId: u.perfilId ?? '', novaSenha: '',
      cpf: u.cpf ?? '', telefone: u.telefone ?? '', cep: u.cep ?? '',
      logradouro: u.logradouro ?? '', numero: u.numero ?? '', complemento: u.complemento ?? '',
      bairro: u.bairro ?? '', municipio: u.municipio ?? '', uf: u.uf ?? '',
    });
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    if (editForm.novaSenha && editForm.novaSenha.length < 10) { toastError('Senha deve ter no mínimo 10 caracteres.'); return; }
    setEditSaving(true);
    try {
      const payload: Record<string, string> = {};
      if (editForm.nome !== editTarget.nome) payload.nome = editForm.nome;
      if (editForm.email !== editTarget.email) payload.email = editForm.email;
      if (editForm.perfilId && editForm.perfilId !== (editTarget.perfilId ?? '')) payload.perfilId = editForm.perfilId;
      if (editForm.novaSenha) payload.novaSenha = editForm.novaSenha;
      if (editForm.cpf !== (editTarget.cpf ?? '')) payload.cpf = editForm.cpf;
      if (editForm.telefone !== (editTarget.telefone ?? '')) payload.telefone = editForm.telefone;
      if (editForm.cep !== (editTarget.cep ?? '')) payload.cep = editForm.cep;
      if (editForm.logradouro !== (editTarget.logradouro ?? '')) payload.logradouro = editForm.logradouro;
      if (editForm.numero !== (editTarget.numero ?? '')) payload.numero = editForm.numero;
      if (editForm.complemento !== (editTarget.complemento ?? '')) payload.complemento = editForm.complemento;
      if (editForm.bairro !== (editTarget.bairro ?? '')) payload.bairro = editForm.bairro;
      if (editForm.municipio !== (editTarget.municipio ?? '')) payload.municipio = editForm.municipio;
      if (editForm.uf !== (editTarget.uf ?? '')) payload.uf = editForm.uf;

      await api.patch(`/auth/usuarios/${editTarget.id}`, payload);
      success('Usuário atualizado!');
      setEditTarget(null);
      void load();
    } catch (e: any) {
      const msgs: string[] | undefined = e?.response?.data?.message;
      const detail = Array.isArray(msgs) ? msgs.join(' | ') : (e?.response?.data?.message ?? 'Erro ao atualizar usuário.');
      toastError(detail);
    } finally {
      setEditSaving(false);
    }
  };

  const handleInativar = async () => {
    if (!inativarTarget) return;
    try {
      await api.delete(`/auth/usuarios/${inativarTarget.id}`);
      success('Usuário inativado.');
      setInativarTarget(null);
      void load();
    } catch {
      toastError('Erro ao inativar usuário.');
    }
  };

  const handleExcluir = async () => {
    if (!excluirTarget) return;
    try {
      await api.delete(`/auth/usuarios/${excluirTarget.id}/remover`);
      success('Usuário excluído permanentemente.');
      setExcluirTarget(null);
      void load();
    } catch (e: any) {
      toastError(e?.response?.data?.message ?? 'Erro ao excluir usuário.');
      setExcluirTarget(null);
    }
  };

  const handleReativar = async () => {
    if (!reativarTarget) return;
    try {
      await api.patch(`/auth/usuarios/${reativarTarget.id}/reativar`);
      success('Usuário reativado.');
      setReativarTarget(null);
      void load();
    } catch (e: any) {
      toastError(e?.response?.data?.message ?? 'Erro ao reativar usuário.');
      setReativarTarget(null);
    }
  };

  const columns = [
    {
      key: 'nome',
      header: 'Nome',
      render: (u: Usuario) => <span className="font-medium text-foreground">{u.nome}</span>,
    },
    { key: 'email', header: 'E-mail', render: (u: Usuario) => u.email },
    {
      key: 'perfil',
      header: 'Perfil',
      render: (u: Usuario) => {
        const perfil = perfis.find((p) => p.id === u.perfilId);
        if (!perfil) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${ROLE_BADGE_CLS[perfil.role as Role] ?? 'bg-muted text-muted-foreground'}`}>
            {perfil.nome}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (u: Usuario) => {
        if (u.aguardandoAtivacao) return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
            <ClockIcon size={11} />Aguardando 1º acesso
          </span>
        );
        if (!u.ativo) return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-muted text-muted-foreground">Inativo</span>;
        return <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700">Ativo</span>;
      },
    },
    {
      key: 'criadoEm',
      header: 'Criado em',
      render: (u: Usuario) => new Date(u.criadoEm).toLocaleDateString('pt-BR'),
    },
    {
      key: 'acoes',
      header: 'Ações',
      render: (u: Usuario) => (
        <ActionsMenu actions={[
          { label: 'Editar', icon: <PencilSimpleIcon size={14} />, onClick: () => openEdit(u), hidden: !isAdmin },
          { label: 'Inativar', icon: <UserMinusIcon size={14} />, onClick: () => setInativarTarget(u), variant: 'danger', hidden: !isAdmin || !u.ativo },
          { label: 'Reativar', icon: <UserPlusIcon size={14} />, onClick: () => setReativarTarget(u), hidden: !isAdmin || u.ativo },
          { label: 'Excluir', icon: <TrashIcon size={14} />, onClick: () => setExcluirTarget(u), variant: 'danger', hidden: !isAdmin },
        ]} />
      ),
    },
  ];

  const inputCls = 'w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors';
  const selectCls = 'w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors';

  return (
    <div className="flex flex-col gap-5 flex-1 min-h-0 h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Usuários</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {filteredUsuarios.length} de {usuarios.length} usuário(s)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors"
          >
            <ArrowClockwiseIcon size={15} /> Atualizar
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => { setForm(FORM_INITIAL); setShowForm(true); }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <PlusIcon size={16} /> Novo Usuário
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-5 pr-2 pb-4">
        <div className="bg-card rounded-lg border border-border shadow-sm p-5 space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou e-mail..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-input text-sm text-foreground placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
              />
            </div>

            <select
              aria-label="Filtrar por perfil"
              value={filterPerfilId}
              onChange={(e) => setFilterPerfilId(e.target.value)}
              className="rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            >
              <option value="">Todos os perfis</option>
              {perfis.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>

            <select
              aria-label="Filtrar por status"
              value={filterAtivo}
              onChange={(e) => setFilterAtivo(e.target.value as '' | 'true' | 'false' | 'pendente')}
              className="rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            >
              <option value="">Todos os status</option>
              <option value="true">Ativo</option>
              <option value="false">Inativo</option>
              <option value="pendente">Aguardando 1º acesso</option>
            </select>

            {(search || filterPerfilId || filterAtivo) && (
              <button
                type="button"
                onClick={() => { setSearch(''); setFilterPerfilId(''); setFilterAtivo(''); }}
                className="text-xs text-muted-foreground hover:text-muted-foreground hover:underline transition-colors"
              >
                Limpar filtros
              </button>
            )}
          </div>

          <DataTable
            columns={columns}
            data={pagedUsuarios}
            isLoading={isLoading}
            keyExtractor={(u) => u.id}
            emptyMessage="Nenhum usuário encontrado."
          />

          <Pagination
            page={page}
            totalPages={totalPages}
            total={filteredUsuarios.length}
            limit={PAGE_SIZE}
            onPageChange={setPage}
          />
        </div>
      </div>

      {/* Modal Novo Usuário */}
      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Novo Usuário" size="2xl">
        <form onSubmit={(e) => void handleCreate(e)} className="space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-bold text-primary uppercase tracking-wider">Acesso ao Sistema</span>
              <div className="flex-1 border-t border-border" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label htmlFor="novo-nome" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Nome completo</label>
                <Input id="novo-nome" value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} placeholder="Nome completo" required />
              </div>
              <div className="col-span-2">
                <label htmlFor="novo-email" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">E-mail</label>
                <Input id="novo-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="email@exemplo.com" required />
              </div>
              <div className="col-span-2">
                <label htmlFor="novo-role" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Perfil</label>
                <select id="novo-perfil" aria-label="Perfil" value={form.perfilId} onChange={(e) => setForm((f) => ({ ...f, perfilId: e.target.value }))} className={selectCls} required>
                  <option value="" disabled>Selecione um perfil</option>
                  {perfis.map((p) => (<option key={p.id} value={p.id}>{p.nome}</option>))}
                </select>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-bold text-primary uppercase tracking-wider">Dados Pessoais</span>
              <div className="flex-1 border-t border-border" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="novo-cpf" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">CPF</label>
                <Input id="novo-cpf" value={form.cpf} onChange={(e) => setForm((f) => ({ ...f, cpf: e.target.value }))} placeholder="000.000.000-00" maxLength={14} />
              </div>
              <div>
                <label htmlFor="novo-telefone" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Telefone</label>
                <Input id="novo-telefone" value={form.telefone} onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))} placeholder="(00) 00000-0000" maxLength={15} />
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-bold text-primary uppercase tracking-wider">Endereço</span>
              <div className="flex-1 border-t border-border" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="novo-cep" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">CEP</label>
                <div className="relative">
                  <Input id="novo-cep" value={form.cep} onChange={(e) => setForm((f) => ({ ...f, cep: e.target.value }))} onBlur={(e) => void buscarCep(e.target.value)} placeholder="00000-000" maxLength={9} />
                  {cepLoading && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">...</span>}
                </div>
              </div>
              <div>
                <label htmlFor="novo-uf" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">UF</label>
                <Input id="novo-uf" value={form.uf} onChange={(e) => setForm((f) => ({ ...f, uf: e.target.value.toUpperCase() }))} placeholder="SP" maxLength={2} />
              </div>
              <div className="col-span-2">
                <label htmlFor="novo-logradouro" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Logradouro</label>
                <Input id="novo-logradouro" value={form.logradouro} onChange={(e) => setForm((f) => ({ ...f, logradouro: e.target.value }))} placeholder="Rua, Avenida..." />
              </div>
              <div>
                <label htmlFor="novo-numero" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Número</label>
                <Input id="novo-numero" value={form.numero} onChange={(e) => setForm((f) => ({ ...f, numero: e.target.value }))} placeholder="S/N" />
              </div>
              <div>
                <label htmlFor="novo-complemento" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Complemento</label>
                <Input id="novo-complemento" value={form.complemento} onChange={(e) => setForm((f) => ({ ...f, complemento: e.target.value }))} placeholder="Apto, Sala..." />
              </div>
              <div>
                <label htmlFor="novo-bairro" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Bairro</label>
                <Input id="novo-bairro" value={form.bairro} onChange={(e) => setForm((f) => ({ ...f, bairro: e.target.value }))} placeholder="Bairro" />
              </div>
              <div>
                <label htmlFor="novo-municipio" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Município</label>
                <Input id="novo-municipio" value={form.municipio} onChange={(e) => setForm((f) => ({ ...f, municipio: e.target.value }))} placeholder="Cidade" />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-border">
            <button type="button" onClick={() => setShowForm(false)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
              {saving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : null}
              Criar Usuário
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Editar Usuário */}
      <Modal isOpen={!!editTarget} onClose={() => setEditTarget(null)} title={`Editar: ${editTarget?.nome ?? ''}`} size="2xl">
        <form onSubmit={(e) => void handleEdit(e)} className="space-y-5">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-primary uppercase tracking-wider">Acesso ao Sistema</span>
              <div className="flex-1 border-t border-border" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label htmlFor="edit-nome" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Nome completo</label>
                <Input id="edit-nome" value={editForm.nome} onChange={(e) => setEditForm((f) => ({ ...f, nome: e.target.value }))} placeholder="Nome completo" required />
              </div>
              <div className="col-span-2">
                <label htmlFor="edit-email" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">E-mail</label>
                <Input id="edit-email" type="email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} placeholder="email@exemplo.com" required />
              </div>
              <div>
                <label htmlFor="edit-role" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Perfil</label>
                <select id="edit-perfil" aria-label="Perfil" value={editForm.perfilId} onChange={(e) => setEditForm((f) => ({ ...f, perfilId: e.target.value }))} className={selectCls}>
                  <option value="" disabled>Selecione um perfil</option>
                  {perfis.map((p) => (<option key={p.id} value={p.id}>{p.nome}</option>))}
                </select>
              </div>
              <div>
                <label htmlFor="edit-novasenha" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Nova senha <span className="text-muted-foreground font-normal text-xs">(em branco = manter)</span>
                </label>
                <Input id="edit-novasenha" type="password" value={editForm.novaSenha} onChange={(e) => setEditForm((f) => ({ ...f, novaSenha: e.target.value }))} placeholder="Mín. 10 car." minLength={editForm.novaSenha ? 10 : undefined} />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-primary uppercase tracking-wider">Dados Pessoais</span>
              <div className="flex-1 border-t border-border" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="edit-cpf" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">CPF</label>
                <Input id="edit-cpf" value={editForm.cpf} onChange={(e) => setEditForm((f) => ({ ...f, cpf: e.target.value }))} placeholder="000.000.000-00" maxLength={14} />
              </div>
              <div>
                <label htmlFor="edit-telefone" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Telefone</label>
                <Input id="edit-telefone" value={editForm.telefone} onChange={(e) => setEditForm((f) => ({ ...f, telefone: e.target.value }))} placeholder="(00) 00000-0000" maxLength={15} />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-primary uppercase tracking-wider">Endereço</span>
              <div className="flex-1 border-t border-border" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="edit-cep" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">CEP</label>
                <Input id="edit-cep" value={editForm.cep} onChange={(e) => setEditForm((f) => ({ ...f, cep: e.target.value }))} onBlur={(e) => void buscarCepEdit(e.target.value)} placeholder="00000-000" maxLength={9} />
              </div>
              <div className="col-span-2">
                <label htmlFor="edit-logradouro" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Logradouro</label>
                <Input id="edit-logradouro" value={editForm.logradouro} onChange={(e) => setEditForm((f) => ({ ...f, logradouro: e.target.value }))} placeholder="Rua, Avenida..." />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="edit-numero" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Número</label>
                <Input id="edit-numero" value={editForm.numero} onChange={(e) => setEditForm((f) => ({ ...f, numero: e.target.value }))} placeholder="N°" />
              </div>
              <div className="col-span-2">
                <label htmlFor="edit-complemento" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Complemento</label>
                <Input id="edit-complemento" value={editForm.complemento} onChange={(e) => setEditForm((f) => ({ ...f, complemento: e.target.value }))} placeholder="Sala, Andar..." />
              </div>
            </div>
            <div className="grid grid-cols-5 gap-3">
              <div className="col-span-2">
                <label htmlFor="edit-bairro" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Bairro</label>
                <Input id="edit-bairro" value={editForm.bairro} onChange={(e) => setEditForm((f) => ({ ...f, bairro: e.target.value }))} placeholder="Bairro" />
              </div>
              <div className="col-span-2">
                <label htmlFor="edit-municipio" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Município</label>
                <Input id="edit-municipio" value={editForm.municipio} onChange={(e) => setEditForm((f) => ({ ...f, municipio: e.target.value }))} placeholder="Cidade" />
              </div>
              <div>
                <label htmlFor="edit-uf" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">UF</label>
                <Input id="edit-uf" value={editForm.uf} onChange={(e) => setEditForm((f) => ({ ...f, uf: e.target.value.toUpperCase().slice(0, 2) }))} placeholder="AL" maxLength={2} />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-border">
            <button type="button" onClick={() => setEditTarget(null)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={editSaving} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
              {editSaving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : null}
              Salvar Alterações
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!inativarTarget}
        title="Inativar Usuário"
        message={`Tem certeza que deseja inativar "${inativarTarget?.nome}"? O usuário perderá acesso ao sistema.`}
        confirmLabel="Sim, inativar"
        onConfirm={() => void handleInativar()}
        onCancel={() => setInativarTarget(null)}
      />

      <ConfirmDialog
        isOpen={!!excluirTarget}
        title="Excluir Usuário Permanentemente"
        message={`Atenção: esta ação é irreversível. O usuário "${excluirTarget?.nome}" (${excluirTarget?.email}) será removido definitivamente do sistema. Deseja continuar?`}
        confirmLabel="Sim, excluir"
        onConfirm={() => void handleExcluir()}
        onCancel={() => setExcluirTarget(null)}
      />

      <ConfirmDialog
        isOpen={!!reativarTarget}
        title="Reativar Usuário"
        message={`Deseja reativar "${reativarTarget?.nome}"? O usuário voltará a ter acesso ao sistema.`}
        confirmLabel="Sim, reativar"
        onConfirm={() => void handleReativar()}
        onCancel={() => setReativarTarget(null)}
      />

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
