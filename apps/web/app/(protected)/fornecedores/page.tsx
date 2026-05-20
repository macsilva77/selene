'use client';
import { useEffect, useCallback, useState } from 'react';
import { MagnifyingGlass, ArrowClockwise, FloppyDisk, UserMinus, PencilSimple } from '@phosphor-icons/react';
import { ActionsMenu } from '@/components/ui/actions-menu';
import { DataTable } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast, ToastContainer } from '@/components/ui/toast';
import { api } from '@/lib/api';

function maskCnpj(value: string): string {
  const d = value.replaceAll(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2}\.\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{2}\.\d{3}\.\d{3})(\d)/, '$1/$2')
    .replace(/^(\d{2}\.\d{3}\.\d{3}\/\d{4})(\d)/, '$1-$2');
}

interface Fornecedor {
  id: string;
  cnpj: string;
  nome: string;
  nomeFantasia?: string;
  email?: string;
  telefone?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  inscricaoEstadual?: string;
  inscricaoMunicipal?: string;
  regimeTributario?: string;
  tipoEstabelecimento?: string;
  cnaePrincipal?: string;
  situacaoCadastral?: string;
  ativo: boolean;
}

type FornForm = Partial<Fornecedor>;

const EMPTY_FORM: FornForm = {
  cnpj: '', nome: '', nomeFantasia: '', email: '', telefone: '',
  cep: '', logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', uf: '',
  inscricaoEstadual: '', inscricaoMunicipal: '', regimeTributario: '',
  tipoEstabelecimento: '', cnaePrincipal: '', situacaoCadastral: '',
};

const PAGE_SIZE = 20;

function getUser() {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(localStorage.getItem('selene_usuario') ?? 'null'); } catch { return null; }
}

export default function FornecedoresPage() {
  const [isGestor, setIsGestor] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const u = getUser();
    const r = u?.role ?? '';
    setIsGestor(r === 'ADMIN' || r === 'GESTOR');
    setIsAdmin(r === 'ADMIN');
  }, []);

  const { toasts, success, error: toastError, info, dismiss } = useToast();

  const [data, setData] = useState<Fornecedor[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const [cnpjInput, setCnpjInput] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [form, setForm] = useState<FornForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [inativarTarget, setInativarTarget] = useState<Fornecedor | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const fetchData = useCallback(async (p: number, q: string) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
      if (q) params.set('search', q);
      const res = await api.get(`/fornecedores?${params}`);
      const d = res.data;
      setData(d.data ?? d ?? []);
      setTotal(d.total ?? (d.data ?? d ?? []).length);
      setTotalPages(d.totalPages ?? Math.max(1, Math.ceil((d.total ?? 0) / PAGE_SIZE)));
    } catch {
      toastError('Erro ao carregar fornecedores.');
    } finally {
      setIsLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void fetchData(page, search); }, [page, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const setField = (key: keyof Fornecedor, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const handleLookup = async () => {
    const digits = cnpjInput.replaceAll(/\D/g, '');
    if (digits.length !== 14) { toastError('Informe um CNPJ completo (14 dígitos).'); return; }
    setLookupLoading(true);
    try {
      const res = await api.get(`/fornecedores/cnpj-lookup/${digits}`);
      const result = res.data;
      if (result.ja_cadastrado) {
        info('Este CNPJ já está cadastrado. Selecionando para edição...');
        const existing = data.find((f) => f.id === result.id_existente);
        if (existing) handleSelectRow(existing);
        return;
      }
      setForm({
        cnpj: result.cnpj, nome: result.nome, nomeFantasia: result.nomeFantasia,
        email: result.email, telefone: result.telefone, cep: result.cep,
        logradouro: result.logradouro, numero: result.numero, complemento: result.complemento,
        bairro: result.bairro, municipio: result.municipio, uf: result.uf,
        situacaoCadastral: result.situacaoCadastral,
        tipoEstabelecimento: result.tipoEstabelecimento,
        cnaePrincipal: result.cnaePrincipal,
        regimeTributario: result.regimeTributario,
      });
      setEditingId(null);
      success('Dados carregados. Confira e clique em Salvar.');
    } catch {
      toastError('CNPJ não encontrado ou erro na consulta.');
    } finally {
      setLookupLoading(false);
    }
  };

  const handleSelectRow = (f: Fornecedor) => {
    setEditingId(f.id);
    setForm({
      cnpj: f.cnpj, nome: f.nome, nomeFantasia: f.nomeFantasia ?? '',
      email: f.email ?? '', telefone: f.telefone ?? '', cep: f.cep ?? '',
      logradouro: f.logradouro ?? '', numero: f.numero ?? '',
      complemento: f.complemento ?? '', bairro: f.bairro ?? '',
      municipio: f.municipio ?? '', uf: f.uf ?? '',
      inscricaoEstadual: f.inscricaoEstadual ?? '',
      inscricaoMunicipal: f.inscricaoMunicipal ?? '',
      regimeTributario: f.regimeTributario ?? '',
      tipoEstabelecimento: f.tipoEstabelecimento ?? '',
      cnaePrincipal: f.cnaePrincipal ?? '',
      situacaoCadastral: f.situacaoCadastral ?? '',
    });
    setCnpjInput(f.cnpj);
    setShowEditModal(true);
  };

  const handleClear = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setCnpjInput('');
    setShowAddModal(false);
    setShowEditModal(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.cnpj || !form.nome) { toastError('Nome e CNPJ são obrigatórios.'); return; }
    setSaving(true);
    const payload = Object.fromEntries(
      Object.entries(form).filter(([k, v]) => (editingId ? k !== 'cnpj' : true) && v !== '' && v !== null && v !== undefined),
    ) as Partial<Fornecedor>;
    try {
      if (editingId) {
        await api.patch(`/fornecedores/${editingId}`, payload);
        success('Fornecedor atualizado!');
      } else {
        await api.post('/fornecedores', payload);
        success('Fornecedor cadastrado com sucesso!');
      }
      handleClear();
      void fetchData(page, search);
    } catch {
      toastError('Erro ao salvar fornecedor.');
    } finally {
      setSaving(false);
    }
  };

  const handleInativar = async () => {
    if (!inativarTarget) return;
    try {
      await api.patch(`/fornecedores/${inativarTarget.id}/inativar`);
      success('Fornecedor inativado.');
      if (editingId === inativarTarget.id) handleClear();
      setInativarTarget(null);
      void fetchData(page, search);
    } catch {
      toastError('Erro ao inativar fornecedor.');
    }
  };

  const handleSearch = () => {
    setPage(1);
    setSearch(searchInput);
  };

  const columns = [
    {
      key: 'nome', header: 'Razão Social',
      render: (f: Fornecedor) => (
        <div>
          <p className="font-medium text-foreground">{f.nome}</p>
          {f.nomeFantasia && <p className="text-xs text-muted-foreground">{f.nomeFantasia}</p>}
        </div>
      ),
    },
    { key: 'cnpj', header: 'CNPJ', render: (f: Fornecedor) => <span className="font-mono text-sm">{f.cnpj}</span> },
    {
      key: 'municipio', header: 'Município/UF',
      render: (f: Fornecedor) => f.municipio ? `${f.municipio}${f.uf ? `/${f.uf}` : ''}` : '—',
    },
    {
      key: 'tipoEstabelecimento', header: 'Tipo',
      render: (f: Fornecedor) => f.tipoEstabelecimento
        ? <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-muted text-muted-foreground">{f.tipoEstabelecimento}</span>
        : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'situacaoCadastral', header: 'Situação',
      render: (f: Fornecedor) => {
        if (!f.situacaoCadastral) return <span className="text-muted-foreground">—</span>;
        const isAtiva = f.situacaoCadastral.toUpperCase() === 'ATIVA';
        return (
          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${isAtiva ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {f.situacaoCadastral}
          </span>
        );
      },
    },
    {
      key: 'regimeTributario', header: 'Regime',
      render: (f: Fornecedor) => f.regimeTributario ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'ativo', header: 'Status',
      render: (f: Fornecedor) => (
        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${f.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
          {f.ativo ? 'Ativo' : 'Inativo'}
        </span>
      ),
    },
    {
      key: 'acoes', header: '',
      render: (f: Fornecedor) => (
        <ActionsMenu actions={[
          { label: 'Editar', icon: <PencilSimple size={14} />, onClick: () => handleSelectRow(f), hidden: !isGestor },
          { label: 'Inativar', icon: <UserMinus size={14} />, onClick: () => setInativarTarget(f), variant: 'danger', hidden: !isAdmin || !f.ativo },
        ]} />
      ),
    },
  ];

  const formFields = (prefix: string) => (
    <>
      {/* Identificação */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-primary uppercase tracking-wider">Identificação</span>
          <div className="flex-1 border-t border-border" />
        </div>
        <div>
          <label htmlFor={`${prefix}-nome`} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Razão Social *</label>
          <Input id={`${prefix}-nome`} value={form.nome ?? ''} onChange={(e) => setField('nome', e.target.value)} placeholder="Nome da empresa" required />
        </div>
        <div>
          <label htmlFor={`${prefix}-nomeFantasia`} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Nome Fantasia</label>
          <Input id={`${prefix}-nomeFantasia`} value={form.nomeFantasia ?? ''} onChange={(e) => setField('nomeFantasia', e.target.value)} placeholder="Como é conhecido" />
        </div>
      </div>

      {/* Contato */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-primary uppercase tracking-wider">Contato</span>
          <div className="flex-1 border-t border-border" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${prefix}-email`} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">E-mail</label>
            <Input id={`${prefix}-email`} type="email" value={form.email ?? ''} onChange={(e) => setField('email', e.target.value)} placeholder="contato@empresa.com" />
          </div>
          <div>
            <label htmlFor={`${prefix}-telefone`} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Telefone</label>
            <Input id={`${prefix}-telefone`} value={form.telefone ?? ''} onChange={(e) => setField('telefone', e.target.value)} placeholder="(00) 00000-0000" />
          </div>
        </div>
      </div>

      {/* Endereço */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-primary uppercase tracking-wider">Endereço</span>
          <div className="flex-1 border-t border-border" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label htmlFor={`${prefix}-cep`} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">CEP</label>
            <Input id={`${prefix}-cep`} value={form.cep ?? ''} onChange={(e) => setField('cep', e.target.value)} placeholder="00000-000" maxLength={10} />
          </div>
          <div className="col-span-2">
            <label htmlFor={`${prefix}-logradouro`} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Logradouro</label>
            <Input id={`${prefix}-logradouro`} value={form.logradouro ?? ''} onChange={(e) => setField('logradouro', e.target.value)} placeholder="Rua, Avenida..." />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label htmlFor={`${prefix}-numero`} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Número</label>
            <Input id={`${prefix}-numero`} value={form.numero ?? ''} onChange={(e) => setField('numero', e.target.value)} placeholder="N°" />
          </div>
          <div className="col-span-2">
            <label htmlFor={`${prefix}-complemento`} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Complemento</label>
            <Input id={`${prefix}-complemento`} value={form.complemento ?? ''} onChange={(e) => setField('complemento', e.target.value)} placeholder="Sala, Andar..." />
          </div>
        </div>
        <div className="grid grid-cols-5 gap-3">
          <div className="col-span-2">
            <label htmlFor={`${prefix}-bairro`} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Bairro</label>
            <Input id={`${prefix}-bairro`} value={form.bairro ?? ''} onChange={(e) => setField('bairro', e.target.value)} placeholder="Bairro" />
          </div>
          <div className="col-span-2">
            <label htmlFor={`${prefix}-municipio`} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Município</label>
            <Input id={`${prefix}-municipio`} value={form.municipio ?? ''} onChange={(e) => setField('municipio', e.target.value)} placeholder="Cidade" />
          </div>
          <div>
            <label htmlFor={`${prefix}-uf`} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">UF</label>
            <Input id={`${prefix}-uf`} value={form.uf ?? ''} onChange={(e) => setField('uf', e.target.value.toUpperCase().slice(0, 2))} placeholder="AL" maxLength={2} />
          </div>
        </div>
      </div>

      {/* Fiscal */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-primary uppercase tracking-wider">Fiscal</span>
          <div className="flex-1 border-t border-border" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${prefix}-situacao`} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Situação Cadastral</label>
            <Input id={`${prefix}-situacao`} value={form.situacaoCadastral ?? ''} onChange={(e) => setField('situacaoCadastral', e.target.value)} placeholder="Ex: ATIVA" />
          </div>
          <div>
            <label htmlFor={`${prefix}-tipo`} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Tipo</label>
            <Input id={`${prefix}-tipo`} value={form.tipoEstabelecimento ?? ''} onChange={(e) => setField('tipoEstabelecimento', e.target.value)} placeholder="MATRIZ / FILIAL" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${prefix}-regime`} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Regime Tributário</label>
            <Input id={`${prefix}-regime`} value={form.regimeTributario ?? ''} onChange={(e) => setField('regimeTributario', e.target.value)} placeholder="Ex: Simples Nacional" />
          </div>
          <div>
            <label htmlFor={`${prefix}-cnae`} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">CNAE Principal</label>
            <Input id={`${prefix}-cnae`} value={form.cnaePrincipal ?? ''} onChange={(e) => setField('cnaePrincipal', e.target.value)} placeholder="Código - Descrição" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${prefix}-ie`} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Inscrição Estadual</label>
            <Input id={`${prefix}-ie`} value={form.inscricaoEstadual ?? ''} onChange={(e) => setField('inscricaoEstadual', e.target.value)} placeholder="Nº da IE" />
          </div>
          <div>
            <label htmlFor={`${prefix}-im`} className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Inscrição Municipal</label>
            <Input id={`${prefix}-im`} value={form.inscricaoMunicipal ?? ''} onChange={(e) => setField('inscricaoMunicipal', e.target.value)} placeholder="Nº do ISS" />
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex flex-col gap-5 flex-1 min-h-0 h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Fornecedores</h1>
          <p className="text-sm text-muted-foreground mt-1">{total} registros encontrados</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchData(page, search)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors"
          >
            <ArrowClockwise size={15} /> Atualizar
          </button>
          {isGestor && (
            <button
              type="button"
              onClick={() => { setForm(EMPTY_FORM); setCnpjInput(''); setEditingId(null); setShowAddModal(true); }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              + Novo Fornecedor
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-5 pr-2 pb-4">
        {/* Table card */}
        <div className="bg-card rounded-lg border border-border shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Fornecedores Cadastrados</h2>
            <div className="relative flex items-center gap-2">
              <div className="relative">
                <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                  placeholder="Buscar por nome ou CNPJ..."
                  className="pl-9 pr-3 py-2 text-sm border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary w-64"
                />
              </div>
              <button
                type="button"
                onClick={handleSearch}
                className="px-3 py-2 text-sm rounded-lg border border-input text-muted-foreground hover:bg-muted transition-colors"
              >
                Buscar
              </button>
            </div>
          </div>

          <DataTable
            columns={columns}
            data={data}
            isLoading={isLoading}
            keyExtractor={(f) => f.id}
            emptyMessage="Nenhum fornecedor encontrado."
            onRowClick={isGestor ? handleSelectRow : undefined}
            rowClassName={(f) => editingId === f.id ? 'bg-orange-50 ring-1 ring-inset ring-primary/30' : ''}
          />

          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            limit={PAGE_SIZE}
            onPageChange={(p) => setPage(p)}
          />
        </div>
      </div>

      {/* Modal: Novo Fornecedor */}
      {isGestor && (
        <Modal isOpen={showAddModal} onClose={handleClear} title="Novo Fornecedor" size="2xl">
          <div className="space-y-5">
            {/* CNPJ lookup */}
            <div className="space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-bold text-primary uppercase tracking-wider">Buscar na Receita Federal</span>
              <div className="flex-1 border-t border-border" />
            </div>
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <input
                    id="forn-cnpj"
                    type="text"
                    value={cnpjInput}
                    onChange={(e) => setCnpjInput(maskCnpj(e.target.value))}
                    placeholder="00.000.000/0000-00"
                    maxLength={18}
                    className="w-full px-3 py-2 text-sm border border-input rounded-lg shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary font-mono"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleLookup(); } }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleLookup()}
                  disabled={lookupLoading}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {lookupLoading
                    ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    : <MagnifyingGlass size={15} />
                  }
                  Buscar
                </button>
              </div>
            </div>

            <form onSubmit={(e) => void handleSave(e)} className="space-y-5">
              {formFields('add')}
              <div className="flex justify-end gap-3 pt-2 border-t border-border">
                <button type="button" onClick={handleClear} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {saving
                    ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    : <FloppyDisk size={15} />
                  }
                  Cadastrar Fornecedor
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* Modal: Editar Fornecedor */}
      {isGestor && editingId && (
        <Modal
          isOpen={showEditModal}
          onClose={handleClear}
          title={form.nomeFantasia || form.nome || 'Editar Fornecedor'}
          size="2xl"
        >
          <form onSubmit={(e) => void handleSave(e)} className="space-y-5">
            {/* CNPJ read-only */}
            <div className="flex items-center gap-3 rounded-lg bg-muted border border-input px-4 py-2.5">
              <span className="text-sm font-bold text-primary uppercase tracking-wider">CNPJ</span>
              <span className="font-mono text-sm font-semibold text-foreground">{form.cnpj}</span>
            </div>

            {formFields('forn')}

            <div className="flex justify-end gap-3 pt-2 border-t border-border">
              <button type="button" onClick={handleClear} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {saving
                  ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  : <FloppyDisk size={15} />
                }
                Salvar Alterações
              </button>
            </div>
          </form>
        </Modal>
      )}

      <ConfirmDialog
        isOpen={!!inativarTarget}
        title="Inativar Fornecedor"
        message={`Tem certeza que deseja inativar "${inativarTarget?.nome}"? O fornecedor não poderá ser associado a novos contratos.`}
        confirmLabel="Sim, inativar"
        onConfirm={() => void handleInativar()}
        onCancel={() => setInativarTarget(null)}
      />

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
