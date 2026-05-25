'use client';
import { useEffect, useState } from 'react';
import { PlusIcon, MagnifyingGlassIcon, XIcon, PencilSimpleIcon, InfoIcon, MapPinIcon, SealCheckIcon, EnvelopeSimpleIcon } from '@phosphor-icons/react';
import { DataTable } from '@/components/ui/table';
import { Modal } from '@/components/ui/modal';
import { Pagination } from '@/components/ui/pagination';
import { useToast, ToastContainer } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';

interface Empresa {
  id: string;
  tenantId?: string;
  cnpj: string;
  nome: string;
  nomeFantasia?: string;
  email?: string;
  telefone?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  situacaoCadastral?: string;
  tipoEstabelecimento?: string;
  cnaePrincipal?: string;
  cnaeSecundario?: string;
  quadroSocietario?: string;
  regimeTributario?: string;
  inscricaoEstadual?: string;
  inscricaoMunicipal?: string;
  naturezaJuridica?: string;
  dataInicioAtividade?: string;
  ativo: boolean;
  criadoEm?: string;
}

interface Tenant {
  id: string;
  nome: string;
  cnpj?: string;
  nomeFantasia?: string;
  email?: string;
  telefone?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  plano?: string;
  cnaePrincipal?: string;
  inscricaoEstadual?: string;
  inscricaoMunicipal?: string;
  regimeTributario?: string;
  situacaoCadastral?: string;
  tipoEstabelecimento?: string;
}

type EmpForm = Omit<Empresa, 'id' | 'tenantId' | 'ativo' | 'criadoEm'>;

const EMPTY_FORM: EmpForm = {
  cnpj: '', nome: '', nomeFantasia: '', email: '', telefone: '',
  cep: '', logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', uf: '',
  situacaoCadastral: '', tipoEstabelecimento: '', cnaePrincipal: '', cnaeSecundario: '', quadroSocietario: '',
  regimeTributario: '', inscricaoEstadual: '', inscricaoMunicipal: '',
  naturezaJuridica: '', dataInicioAtividade: '',
};

function getRaiz(cnpj?: string | null) {
  // Remove pontuação, pega os 8 primeiros chars (raiz do CNPJ)
  return (cnpj ?? '').replace(/[.\-/\s]/g, '').slice(0, 8);
}

function displayCnpj(cnpj?: string | null) {
  if (!cnpj) return '—';
  const raw = cnpj.replace(/[.\-/\s]/g, '');
  // Formata apenas se forem 14 dígitos numéricos (CNPJ tradicional)
  if (/^\d{14}$/.test(raw)) {
    return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8, 12)}-${raw.slice(12)}`;
  }
  // CNPJ alfanumérico: exibe sem formatação
  return raw;
}

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}


const inputCls = 'w-full rounded-lg border border-input px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors';

function LabelInput({ id, label, value, onChange, placeholder, type = 'text', maxLength, readOnly }: {
  id: string; label: string; value?: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string; type?: string; maxLength?: number; readOnly?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{label}</label>
      <input id={id} type={type} value={value ?? ''} onChange={onChange} placeholder={placeholder} maxLength={maxLength} readOnly={readOnly}
        className={`${inputCls} ${readOnly ? 'bg-muted text-muted-foreground' : ''}`} />
    </div>
  );
}

export default function EmpresasPage() {
  const router = useRouter();

  const { toasts, success, error: toastError, dismiss } = useToast();

  const [_tenant, setTenant] = useState<Tenant | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingEmpresas, setLoadingEmpresas] = useState(true);
  const [search, setSearch] = useState('');
  const [empPage, setEmpPage] = useState(1);
  const EMP_PAGE_SIZE = 10;
  const [selectedId, _setSelectedId] = useState<string | null>(null);
  const [searchCnpj, setSearchCnpj] = useState('');
  const [detalheEmpresa, setDetalheEmpresa] = useState<Empresa | null>(null);
  const [showDetalheModal, setShowDetalheModal] = useState(false);
  const [certMap, setCertMap] = useState<Record<string, { status: string; validade: string | null; criadoEm: string | null }>>({});
  const [loadingCerts, setLoadingCerts] = useState(false);

  // Modals
  const [showEmpresaModal, setShowEmpresaModal] = useState(false);
  const [showTenantModal, setShowTenantModal] = useState(false);
  const [editEmpresa, setEditEmpresa] = useState<Empresa | null>(null);

  // Empresa form
  const [empForm, setEmpForm] = useState<EmpForm>(EMPTY_FORM);
  const [savingEmp, setSavingEmp] = useState(false);
  const [buscandoCnpjEmp, setBuscandoCnpjEmp] = useState(false);
  const [buscandoCepEmp, setBuscandoCepEmp] = useState(false);

  // Tenant form
  const [tenantForm, setTenantForm] = useState<Partial<Tenant>>({});
  const [savingTenant, setSavingTenant] = useState(false);
  const [buscandoCepTen, setBuscandoCepTen] = useState(false);

  const carregarEmpresas = async (q = '', cnpj = '') => {
    setLoadingEmpresas(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('search', q);
      if (cnpj) params.set('cnpj', cnpj.replace(/[.\-/\s]/g, ''));
      const res = await api.get(`/empresas?${params}`);
      const d = res.data;
      setEmpresas(d.data ?? d ?? []);
      setTotal(d.total ?? (d.data ?? d ?? []).length);
      setEmpPage(1);
    } catch { toastError('Erro ao carregar empresas'); }
    finally { setLoadingEmpresas(false); }
  };

  const carregarCerts = async () => {
    setLoadingCerts(true);
    try {
      const res = await api.get('/certificados?limit=200');
      const list: any[] = res.data?.data ?? res.data ?? [];
      const map: Record<string, { status: string; validade: string | null; criadoEm: string | null }> = {};
      for (const cert of list) {
        if (!cert.raizCnpj) continue;
        const prev = map[cert.raizCnpj];
        if (!prev || cert.status === 'ATIVO' || cert.status === 'VALIDO') {
          map[cert.raizCnpj] = { status: cert.status ?? '', validade: cert.dataValidade ?? null, criadoEm: cert.criadoEm ?? null };
        }
      }
      setCertMap(map);
    } catch { /* silently */ }
    finally { setLoadingCerts(false); }
  };

  useEffect(() => {
    Promise.all([
      api.get('/auth/me').catch(() => ({ data: null })),
    ]).then(([me]) => {
      if (me.data) setTenant(me.data?.tenant ?? me.data);
    }).catch(() => toastError('Erro ao carregar dados da conta'));

    void carregarEmpresas();
    void carregarCerts();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const buscarCepTenant = async () => {
    const cep = tenantForm.cep;
    if (!cep) return;
    setBuscandoCepTen(true);
    try {
      const cleaned = cep.replaceAll(/\D/g, '');
      const res = await fetch(`https://brasilapi.com.br/api/cep/v1/${cleaned}`);
      if (!res.ok) { toastError('CEP não encontrado'); return; }
      const d = await res.json() as { street?: string; neighborhood?: string; city?: string; state?: string };
      setTenantForm((f) => ({ ...f, logradouro: d.street ?? f.logradouro, bairro: d.neighborhood ?? f.bairro, municipio: d.city ?? f.municipio, uf: d.state ?? f.uf }));
      success('Endereço preenchido');
    } catch { toastError('CEP não encontrado'); }
    finally { setBuscandoCepTen(false); }
  };

  const salvarTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantForm.nome) { toastError('Razão Social é obrigatória'); return; }
    setSavingTenant(true);
    try {
      const res = await api.patch('/auth/tenant', tenantForm);
      setTenant((prev) => prev ? { ...prev, ...res.data } : res.data);
      setShowTenantModal(false);
      success('Dados da conta atualizados');
    } catch { toastError('Erro ao salvar dados da conta'); }
    finally { setSavingTenant(false); }
  };

  const abrirNovaEmpresa = () => { setEditEmpresa(null); setEmpForm(EMPTY_FORM); setShowEmpresaModal(true); };
  const abrirEdicaoEmpresa = (emp: Empresa) => {
    setEditEmpresa(emp);
    setEmpForm({
      cnpj: emp.cnpj, nome: emp.nome, nomeFantasia: emp.nomeFantasia ?? '',
      email: emp.email ?? '', telefone: emp.telefone ?? '',
      cep: emp.cep ?? '', logradouro: emp.logradouro ?? '', numero: emp.numero ?? '',
      complemento: emp.complemento ?? '', bairro: emp.bairro ?? '',
      municipio: emp.municipio ?? '', uf: emp.uf ?? '',
      situacaoCadastral: emp.situacaoCadastral ?? '', tipoEstabelecimento: emp.tipoEstabelecimento ?? '',
      cnaePrincipal: emp.cnaePrincipal ?? '', cnaeSecundario: emp.cnaeSecundario ?? '',
      quadroSocietario: emp.quadroSocietario ?? '',
      regimeTributario: emp.regimeTributario ?? '',
      inscricaoEstadual: emp.inscricaoEstadual ?? '', inscricaoMunicipal: emp.inscricaoMunicipal ?? '',
      naturezaJuridica: emp.naturezaJuridica ?? '', dataInicioAtividade: emp.dataInicioAtividade ?? '',
    });
    setShowEmpresaModal(true);
  };

  const buscarCnpjEmpresa = async () => {
    if (!empForm.cnpj) return;
    setBuscandoCnpjEmp(true);
    try {
      const digits = empForm.cnpj.replace(/[.\-/\s]/g, '');
      const res = await api.get(`/fornecedores/cnpj-lookup/${digits}`).catch(() => api.get(`/empresas/cnpj-lookup/${digits}`));
      const d = res.data;
      setEmpForm((prev) => ({
        ...prev, cnpj: d.cnpj ?? prev.cnpj,
        nome: d.nome || prev.nome, nomeFantasia: d.nomeFantasia || prev.nomeFantasia,
        email: d.email || prev.email, telefone: d.telefone || prev.telefone,
        cep: d.cep || prev.cep, logradouro: d.logradouro || prev.logradouro,
        numero: d.numero || prev.numero, complemento: d.complemento || prev.complemento,
        bairro: d.bairro || prev.bairro, municipio: d.municipio || prev.municipio, uf: d.uf || prev.uf,
        situacaoCadastral: d.situacaoCadastral || prev.situacaoCadastral,
        tipoEstabelecimento: d.tipoEstabelecimento || prev.tipoEstabelecimento,
        cnaePrincipal: d.cnaePrincipal || prev.cnaePrincipal,
        cnaeSecundario: d.cnaeSecundario || prev.cnaeSecundario,
        quadroSocietario: d.quadroSocietario || prev.quadroSocietario,
        regimeTributario: d.regimeTributario || prev.regimeTributario,
        naturezaJuridica: d.naturezaJuridica || prev.naturezaJuridica,
        dataInicioAtividade: d.dataInicioAtividade || prev.dataInicioAtividade,
      }));
      success('Dados preenchidos automaticamente pelo CNPJ');
    } catch { toastError('CNPJ não encontrado ou erro na consulta'); }
    finally { setBuscandoCnpjEmp(false); }
  };

  const buscarCepEmpresa = async () => {
    if (!empForm.cep) return;
    setBuscandoCepEmp(true);
    try {
      const cleaned = (empForm.cep ?? '').replaceAll(/\D/g, '');
      const res = await fetch(`https://brasilapi.com.br/api/cep/v1/${cleaned}`);
      if (!res.ok) { toastError('CEP não encontrado'); return; }
      const d = await res.json() as { street?: string; neighborhood?: string; city?: string; state?: string };
      setEmpForm((prev) => ({ ...prev, logradouro: d.street || prev.logradouro, bairro: d.neighborhood || prev.bairro, municipio: d.city || prev.municipio, uf: d.state || prev.uf }));
      success('Endereço preenchido');
    } catch { toastError('CEP não encontrado'); }
    finally { setBuscandoCepEmp(false); }
  };

  const salvarEmpresa = async () => {
    if (!empForm.cnpj || !empForm.nome) { toastError('CNPJ e Razão Social são obrigatórios'); return; }
    setSavingEmp(true);
    try {
      const cnpjRaw = empForm.cnpj.replace(/[.\-/\s]/g, '').toUpperCase();
      if (editEmpresa) {
        const { cnpj: _c, ...rest } = empForm; void _c;
        const res = await api.patch(`/empresas/${editEmpresa.id}`, rest);
        setEmpresas((prev) => prev.map((e) => e.id === res.data.id ? res.data : e));
        success('Empresa atualizada');
      } else {
        const res = await api.post('/empresas', { ...empForm, cnpj: cnpjRaw });
        setEmpresas((prev) => [...prev, res.data]);
        setTotal((t) => t + 1);
        success('Empresa cadastrada com sucesso');
      }
      setShowEmpresaModal(false);
    } catch (err: any) {
      toastError(err?.response?.data?.message ?? 'Erro ao salvar empresa');
    } finally { setSavingEmp(false); }
  };

  const renderCertBadge = (cnpj?: string | null) => {
    const raiz = getRaiz(cnpj);
    const cert = certMap[raiz];
    if (loadingCerts) return <span className="text-xs text-muted-foreground">•••</span>;
    if (!cert) return <span className="text-xs px-2 py-0.5 bg-muted text-muted-foreground rounded-full border border-input">Sem cert.</span>;
    const cfg: Record<string, { cls: string; label: string }> = {
      ATIVO:             { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Válido' },
      VALIDO:            { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Válido' },
      EXPIRACAO_PROXIMA: { cls: 'bg-amber-50 text-amber-700 border-amber-200',       label: 'Vence em breve' },
      VENCENDO:          { cls: 'bg-amber-50 text-amber-700 border-amber-200',       label: 'Vencendo' },
      VENCIDO:           { cls: 'bg-red-50 text-red-700 border-red-200',             label: 'Vencido' },
      EXPIRADO:          { cls: 'bg-red-50 text-red-700 border-red-200',             label: 'Expirado' },
    };
    const c = cfg[cert.status] ?? { cls: 'bg-muted text-muted-foreground border-input', label: cert.status };
    return <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${c.cls}`}>{c.label}</span>;
  };

  const fe = (key: keyof EmpForm) => (e: React.ChangeEvent<HTMLInputElement>) => setEmpForm((prev) => ({ ...prev, [key]: e.target.value }));
  const ft = (key: keyof Tenant) => (e: React.ChangeEvent<HTMLInputElement>) => setTenantForm((prev) => ({ ...prev, [key]: e.target.value }));

  type EmpRow = Empresa & { _isTenant?: boolean };
  const pagedEmpresas = empresas.slice((empPage - 1) * EMP_PAGE_SIZE, empPage * EMP_PAGE_SIZE);
  const empTotalPages = Math.max(1, Math.ceil(empresas.length / EMP_PAGE_SIZE));


  const fCls = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary transition-colors placeholder:text-muted-foreground/50';
  const FormField = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0 h-full overflow-y-auto pb-4">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Empresas</h1>
          <p className="text-sm text-muted-foreground mt-1">Clique em uma linha para ver os detalhes</p>
        </div>
        <button type="button" onClick={abrirNovaEmpresa} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          <PlusIcon size={16} /> Nova Empresa
        </button>
      </div>

      {/* Empresas Associadas */}
      <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <p className="font-semibold text-foreground">Empresas</p>
            <p className="text-xs text-muted-foreground">{total} empresa(s)</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Busca por nome */}
            <div className="relative">
              <MagnifyingGlassIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                className="pl-8 pr-3 py-2 text-sm border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary w-44 bg-background"
                placeholder="Buscar por nome..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); void carregarEmpresas(e.target.value, searchCnpj); }}
              />
            </div>
            {/* Busca por CNPJ */}
            <div className="relative">
              <input
                className="pl-3 pr-3 py-2 text-sm border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary w-44 bg-background font-mono"
                placeholder="Filtrar por CNPJ..."
                value={searchCnpj}
                maxLength={18}
                onChange={(e) => { setSearchCnpj(e.target.value); void carregarEmpresas(search, e.target.value); }}
              />
              {searchCnpj && (
                <button type="button" title="Limpar filtro" onClick={() => { setSearchCnpj(''); void carregarEmpresas(search, ''); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <XIcon size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          <DataTable
            columns={[
              {
                key: 'nome', header: 'Razão Social', render: (row: EmpRow) => (
                  <div className="flex flex-col gap-0.5">
                    <span className={`font-medium ${selectedId === row.id ? 'text-primary' : 'text-foreground'}`}>
                      {row.nome || '—'}
                    </span>
                    {row.nomeFantasia && (
                      <span className="text-xs text-muted-foreground">{row.nomeFantasia}</span>
                    )}
                  </div>
                ),
              },
              {
                key: 'cnpj', header: 'CNPJ', render: (row: EmpRow) => (
                  <span className="font-mono text-sm text-foreground/80 whitespace-nowrap">{displayCnpj(row.cnpj)}</span>
                ),
              },
              {
                key: 'cnaePrincipal', header: 'CNAE Principal', render: (row: EmpRow) => (
                  <span className="font-mono text-sm text-foreground/80">{row.cnaePrincipal || '—'}</span>
                ),
              },
              {
                key: 'regimeTributario', header: 'Regime', render: (row: EmpRow) => (
                  <span className="text-sm text-foreground/80 whitespace-nowrap">{row.regimeTributario || '—'}</span>
                ),
              },
              {
                key: 'municipio', header: 'Cidade / UF', render: (row: EmpRow) => (
                  <span className="text-sm text-foreground/80 whitespace-nowrap">
                    {row.municipio ? `${row.municipio}${row.uf ? ` / ${row.uf}` : ''}` : '—'}
                  </span>
                ),
              },
              {
                key: 'situacaoCadastral', header: 'Situação', render: (row: EmpRow) => {
                  const s = row.situacaoCadastral?.toUpperCase();
                  const cls = s === 'ATIVA' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : s === 'INAPTA' ? 'bg-red-50 text-red-700 border border-red-200'
                    : s === 'SUSPENSA' ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-muted text-muted-foreground border border-border';
                  return (
                    <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>
                      {row.situacaoCadastral || '—'}
                    </span>
                  );
                },
              },
              {
                key: 'cert', header: 'Cert. A1', render: (row: EmpRow) => {
                  const cert = certMap[getRaiz(row.cnpj)];
                  return (
                    <div className="flex flex-col gap-0.5">
                      {renderCertBadge(row.cnpj)}
                      {cert?.validade && (
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">Venc.: {fmtDate(cert.validade)}</span>
                      )}
                    </div>
                  );
                },
              },
              {
                key: 'acoes', header: '', render: (row: EmpRow) => (
                  <button type="button" onClick={(e) => { e.stopPropagation(); abrirEdicaoEmpresa(row as Empresa); }}
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-primary transition-colors" title="Editar">
                    <PencilSimpleIcon size={14} />
                  </button>
                ),
              },
            ]}
            data={pagedEmpresas}
            isLoading={loadingEmpresas}
            emptyMessage="Nenhuma empresa cadastrada."
            keyExtractor={(row) => row.id}
            onRowClick={(row) => { setDetalheEmpresa(row as Empresa); setShowDetalheModal(true); }}
            rowClassName={(row) => selectedId === row.id ? 'bg-primary/5' : ''}
          />
        </div>
        {/* Paginação */}
        {!loadingEmpresas && empresas.length > EMP_PAGE_SIZE && (
          <div className="px-5 py-3 border-t border-border shrink-0 flex justify-end">
            <Pagination
              page={empPage}
              totalPages={empTotalPages}
              total={empresas.length}
              limit={EMP_PAGE_SIZE}
              onPageChange={setEmpPage}
            />
          </div>
        )}
      </div>

      {/* Modal: Editar Tenant */}
      <Modal isOpen={showTenantModal} onClose={() => setShowTenantModal(false)} title="Editar Conta Principal" size="2xl">
        <form onSubmit={(e) => void salvarTenant(e)}>
          <div className="space-y-5">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-bold text-primary uppercase tracking-wider">Identificação</span>
                <div className="flex-1 border-t border-border" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <LabelInput id="t-cnpj" label="CNPJ" value={tenantForm.cnpj ?? ''} onChange={ft('cnpj')} placeholder="XX.XXX.XXX/XXXX-XX" />
                <LabelInput id="t-nome" label="Razão Social *" value={tenantForm.nome ?? ''} onChange={ft('nome')} />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-bold text-primary uppercase tracking-wider">Dados Básicos</span>
                <div className="flex-1 border-t border-border" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <LabelInput id="t-nf" label="Nome Fantasia" value={tenantForm.nomeFantasia ?? ''} onChange={ft('nomeFantasia')} />
                <LabelInput id="t-email" label="E-mail" type="email" value={tenantForm.email ?? ''} onChange={ft('email')} />
                <LabelInput id="t-tel" label="Telefone" value={tenantForm.telefone ?? ''} onChange={ft('telefone')} />
                <LabelInput id="t-regime" label="Regime Tributário" value={tenantForm.regimeTributario ?? ''} onChange={ft('regimeTributario')} />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-bold text-primary uppercase tracking-wider">Endereço</span>
                <div className="flex-1 border-t border-border" />
              </div>
              <div className="grid grid-cols-6 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">CEP</label>
                  <div className="flex gap-1.5">
                    <input value={tenantForm.cep ?? ''} onChange={ft('cep')} placeholder="00000-000" maxLength={9} className={inputCls} />
                    <button type="button" title="Buscar endereço pelo CEP" onClick={() => void buscarCepTenant()} disabled={buscandoCepTen} className="px-2.5 rounded-lg border border-input text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50">
                      {buscandoCepTen ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent block" /> : <MagnifyingGlassIcon size={14} />}
                    </button>
                  </div>
                </div>
                <div className="col-span-4"><LabelInput id="t-log" label="Logradouro" value={tenantForm.logradouro ?? ''} onChange={ft('logradouro')} /></div>
                <div className="col-span-2"><LabelInput id="t-num" label="Número" value={tenantForm.numero ?? ''} onChange={ft('numero')} /></div>
                <div className="col-span-4"><LabelInput id="t-comp" label="Complemento" value={tenantForm.complemento ?? ''} onChange={ft('complemento')} /></div>
                <div className="col-span-3"><LabelInput id="t-bairro" label="Bairro" value={tenantForm.bairro ?? ''} onChange={ft('bairro')} /></div>
                <div className="col-span-2"><LabelInput id="t-mun" label="Município" value={tenantForm.municipio ?? ''} onChange={ft('municipio')} /></div>
                <div className="col-span-1"><LabelInput id="t-uf" label="UF" value={tenantForm.uf ?? ''} onChange={ft('uf')} maxLength={2} /></div>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-border mt-1">
            <button type="button" onClick={() => setShowTenantModal(false)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors">
              <XIcon size={14} /> Cancelar
            </button>
            <button type="submit" disabled={savingTenant} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
              {savingTenant ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : null}
              Salvar
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Empresa (criar / editar) */}
      <Modal isOpen={showEmpresaModal} onClose={() => setShowEmpresaModal(false)} title={editEmpresa ? `Editar — ${editEmpresa.nome}` : 'Nova Empresa Associada'} size="3xl">
        <div className="space-y-2.5">

          {/* CNPJ — busca automática (apenas criação) */}
          {!editEmpresa && (
            <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 mb-1 flex items-center gap-3">
              <p className="text-xs font-semibold text-primary shrink-0">CNPJ</p>
              <input
                value={empForm.cnpj}
                onChange={fe('cnpj')}
                placeholder="14 caracteres (ex: 45684942000174)"
                maxLength={18}
                className="flex-1 rounded-lg border border-primary/30 bg-card px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              />
              <button type="button" onClick={() => void buscarCnpjEmpresa()} disabled={buscandoCnpjEmp}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-all disabled:opacity-50 shrink-0">
                {buscandoCnpjEmp ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <MagnifyingGlassIcon size={13} />}
                Buscar
              </button>
            </div>
          )}

          {/* R1: Razão Social (2/3) | Nome Fantasia (1/3) */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="col-span-2">
              <FormField label="Razão Social *">
                <input value={empForm.nome} onChange={fe('nome')} className={fCls} />
              </FormField>
            </div>
            <FormField label="Nome Fantasia">
              <input value={empForm.nomeFantasia ?? ''} onChange={fe('nomeFantasia')} className={fCls} />
            </FormField>
          </div>

          {/* R2: E-mail | Telefone | Situação */}
          <div className="grid grid-cols-3 gap-2.5">
            <FormField label="E-mail">
              <input type="email" value={empForm.email ?? ''} onChange={fe('email')} className={fCls} placeholder="email@empresa.com" />
            </FormField>
            <FormField label="Telefone">
              <input title="Telefone" value={empForm.telefone ?? ''} onChange={fe('telefone')} className={fCls} placeholder="(11) 9 9999-9999" />
            </FormField>
            <FormField label="Situação Cadastral">
              <input title="Situação Cadastral" value={empForm.situacaoCadastral ?? ''} onChange={fe('situacaoCadastral')} className={fCls} placeholder="ATIVA" />
            </FormField>
          </div>

          {/* R3: Logradouro | Número | Complemento */}
          <div className="grid grid-cols-6 gap-2.5">
            <div className="col-span-3">
              <FormField label="Logradouro">
                <input title="Logradouro" value={empForm.logradouro ?? ''} onChange={fe('logradouro')} className={fCls} placeholder="Rua, Avenida, Praça..." />
              </FormField>
            </div>
            <div className="col-span-2">
              <FormField label="Número">
                <input title="Número" value={empForm.numero ?? ''} onChange={fe('numero')} className={fCls} placeholder="123" />
              </FormField>
            </div>
            <FormField label="Complemento">
              <input title="Complemento" value={empForm.complemento ?? ''} onChange={fe('complemento')} className={fCls} placeholder="Sala, Andar..." />
            </FormField>
          </div>

          {/* R4: CEP | Bairro | Município | UF */}
          <div className="grid grid-cols-8 gap-2.5">
            <div className="col-span-2">
              <FormField label="CEP">
                <div className="flex gap-1">
                  <input value={empForm.cep ?? ''} onChange={fe('cep')} placeholder="00000-000" maxLength={9}
                    className="flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors" />
                  <button type="button" title="Buscar endereço pelo CEP" onClick={() => void buscarCepEmpresa()} disabled={buscandoCepEmp}
                    className="px-2 rounded-lg border border-input text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50">
                    {buscandoCepEmp ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent block" /> : <MagnifyingGlassIcon size={12} />}
                  </button>
                </div>
              </FormField>
            </div>
            <div className="col-span-2">
              <FormField label="Bairro">
                <input title="Bairro" value={empForm.bairro ?? ''} onChange={fe('bairro')} className={fCls} placeholder="Bairro" />
              </FormField>
            </div>
            <div className="col-span-3">
              <FormField label="Município">
                <input title="Município" value={empForm.municipio ?? ''} onChange={fe('municipio')} className={fCls} placeholder="São Paulo" />
              </FormField>
            </div>
            <FormField label="UF">
              <input value={empForm.uf ?? ''} onChange={fe('uf')} maxLength={2} className={fCls} placeholder="SP" />
            </FormField>
          </div>

          {/* R5: Regime | Tipo | Natureza Jurídica */}
          <div className="grid grid-cols-3 gap-2.5">
            <FormField label="Regime Tributário">
              <input title="Regime Tributário" value={empForm.regimeTributario ?? ''} onChange={fe('regimeTributario')} className={fCls} placeholder="SIMPLES NACIONAL" />
            </FormField>
            <FormField label="Tipo de Estabelecimento">
              <input title="Tipo de Estabelecimento" value={empForm.tipoEstabelecimento ?? ''} onChange={fe('tipoEstabelecimento')} className={fCls} placeholder="MATRIZ" />
            </FormField>
            <FormField label="Natureza Jurídica">
              <input title="Natureza Jurídica" value={empForm.naturezaJuridica ?? ''} onChange={fe('naturezaJuridica')} className={fCls} placeholder="206-2 Sociedade Empresária Limitada" />
            </FormField>
          </div>

          {/* R6: Data Início | Insc. Estadual | Insc. Municipal */}
          <div className="grid grid-cols-3 gap-2.5">
            <FormField label="Início de Atividade">
              <input value={empForm.dataInicioAtividade ?? ''} onChange={fe('dataInicioAtividade')} className={fCls} placeholder="AAAA-MM-DD" />
            </FormField>
            <FormField label="Inscrição Estadual">
              <input title="Inscrição Estadual" value={empForm.inscricaoEstadual ?? ''} onChange={fe('inscricaoEstadual')} className={fCls} placeholder="000.000.000.000" />
            </FormField>
            <FormField label="Inscrição Municipal">
              <input title="Inscrição Municipal" value={empForm.inscricaoMunicipal ?? ''} onChange={fe('inscricaoMunicipal')} className={fCls} placeholder="000000/001-00" />
            </FormField>
          </div>

          {/* R7: CNAE Principal */}
          <FormField label="CNAE Principal">
            <input title="CNAE Principal" value={empForm.cnaePrincipal ?? ''} onChange={fe('cnaePrincipal')} className={fCls} placeholder="6201-5/01" />
          </FormField>

          {/* R8: CNAE Secundário | Quadro Societário (lado a lado) */}
          <div className="grid grid-cols-2 gap-2.5">
            <FormField label="CNAE Secundário">
              <textarea value={empForm.cnaeSecundario ?? ''} onChange={(e) => setEmpForm((p) => ({ ...p, cnaeSecundario: e.target.value }))}
                rows={2} className={`${fCls} resize-none`} placeholder="CNAEs secundários, um por linha" />
            </FormField>
            <FormField label="Quadro Societário">
              <textarea value={empForm.quadroSocietario ?? ''} onChange={(e) => setEmpForm((p) => ({ ...p, quadroSocietario: e.target.value }))}
                rows={2} className={`${fCls} resize-none`} placeholder="Sócios, participação, qualificação..." />
            </FormField>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-3 border-t border-border mt-3">
          <button type="button" onClick={() => setShowEmpresaModal(false)} className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors">
            <XIcon size={14} /> Cancelar
          </button>
          <button type="button" onClick={() => void salvarEmpresa()} disabled={savingEmp} className="inline-flex items-center gap-2 px-5 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50">
            {savingEmp ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : null}
            {editEmpresa ? 'Salvar Alterações' : 'Cadastrar Empresa'}
          </button>
        </div>
      </Modal>

      {/* Drawer: Detalhe da Empresa */}
      {detalheEmpresa && showDetalheModal && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]" onClick={() => setShowDetalheModal(false)} />
          <div className="fixed top-0 right-0 z-50 h-full w-[500px] max-w-[92vw] bg-card shadow-2xl flex flex-col border-l border-border overflow-hidden">

            {/* ── Header ── */}
            <div className="px-6 py-5 border-b border-border shrink-0">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold text-foreground leading-tight truncate">{detalheEmpresa.nome}</h2>
                    {(() => {
                      const s = detalheEmpresa.situacaoCadastral?.toUpperCase();
                      const cls = s === 'ATIVA' ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                        : s === 'INAPTA' ? 'bg-red-100 text-red-700 border-red-200'
                        : s === 'SUSPENSA' ? 'bg-amber-100 text-amber-700 border-amber-200'
                        : 'bg-muted text-muted-foreground border-border';
                      return detalheEmpresa.situacaoCadastral ? (
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${cls}`}>{detalheEmpresa.situacaoCadastral}</span>
                      ) : null;
                    })()}
                  </div>
                  <p className="text-sm text-muted-foreground font-mono mt-1">{displayCnpj(detalheEmpresa.cnpj)}</p>
                </div>
                <button title="Fechar" onClick={() => setShowDetalheModal(false)} className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0">
                  <XIcon size={16} />
                </button>
              </div>
            </div>

            {/* ── Scrollable body ── */}
            <div className="flex-1 overflow-y-auto">

              {/* Seção: Informações Gerais */}
              <div className="px-6 py-5 border-b border-border/60">
                <div className="flex items-center gap-2 mb-4">
                  <InfoIcon size={14} className="text-primary" weight="fill" />
                  <span className="text-[11px] font-bold text-primary uppercase tracking-widest">Informações Gerais</span>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Razão Social</p>
                    <p className="text-sm font-medium text-foreground">{detalheEmpresa.nome || '—'}</p>
                  </div>
                  {detalheEmpresa.nomeFantasia && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Nome Fantasia</p>
                      <p className="text-sm font-medium text-foreground">{detalheEmpresa.nomeFantasia}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Inscrição Estadual</p>
                      <p className="text-sm font-medium text-foreground">{detalheEmpresa.inscricaoEstadual || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Regime Tributário</p>
                      <p className="text-sm font-medium text-foreground">{detalheEmpresa.regimeTributario || '—'}</p>
                    </div>
                  </div>
                  {detalheEmpresa.cnaePrincipal && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">CNAE Principal</p>
                      <p className="text-sm font-medium text-foreground">{detalheEmpresa.cnaePrincipal}</p>
                    </div>
                  )}
                  {detalheEmpresa.naturezaJuridica && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Natureza Jurídica</p>
                      <p className="text-sm font-medium text-foreground">{detalheEmpresa.naturezaJuridica}</p>
                    </div>
                  )}
                  {(detalheEmpresa.tipoEstabelecimento || detalheEmpresa.dataInicioAtividade) && (
                    <div className="grid grid-cols-2 gap-3">
                      {detalheEmpresa.tipoEstabelecimento && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">Tipo</p>
                          <p className="text-sm font-medium text-foreground">{detalheEmpresa.tipoEstabelecimento}</p>
                        </div>
                      )}
                      {detalheEmpresa.dataInicioAtividade && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">Início de Atividade</p>
                          <p className="text-sm font-medium text-foreground">{new Date(detalheEmpresa.dataInicioAtividade + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
                        </div>
                      )}
                    </div>
                  )}
                  {detalheEmpresa.cnaeSecundario && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">CNAE Secundário</p>
                      <p className="text-sm font-medium text-foreground bg-muted/40 rounded-lg px-3 py-2 whitespace-pre-wrap leading-relaxed">{detalheEmpresa.cnaeSecundario}</p>
                    </div>
                  )}
                  {detalheEmpresa.quadroSocietario && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Quadro Societário</p>
                      <p className="text-sm font-medium text-foreground bg-muted/40 rounded-lg px-3 py-2 whitespace-pre-wrap leading-relaxed">{detalheEmpresa.quadroSocietario}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Seção: Localização */}
              {(detalheEmpresa.logradouro || detalheEmpresa.municipio) && (
                <div className="px-6 py-5 border-b border-border/60">
                  <div className="flex items-center gap-2 mb-4">
                    <MapPinIcon size={14} className="text-primary" weight="fill" />
                    <span className="text-[11px] font-bold text-primary uppercase tracking-widest">Localização</span>
                  </div>
                  <div className="space-y-0.5 text-sm text-foreground mb-3">
                    {(detalheEmpresa.logradouro || detalheEmpresa.numero) && (
                      <p>{[detalheEmpresa.logradouro, detalheEmpresa.numero, detalheEmpresa.complemento].filter(Boolean).join(', ')}</p>
                    )}
                    {(detalheEmpresa.bairro || detalheEmpresa.municipio) && (
                      <p>{[detalheEmpresa.bairro, detalheEmpresa.municipio && detalheEmpresa.uf ? `${detalheEmpresa.municipio} / ${detalheEmpresa.uf}` : detalheEmpresa.municipio].filter(Boolean).join(', ')}</p>
                    )}
                    {detalheEmpresa.cep && (
                      <p className="text-sm text-muted-foreground">CEP: {detalheEmpresa.cep}</p>
                    )}
                  </div>
                  {detalheEmpresa.municipio && (
                    <div className="rounded-lg overflow-hidden border border-border">
                      <iframe
                        title="Localização"
                        src={`https://maps.google.com/maps?q=${encodeURIComponent([detalheEmpresa.logradouro, detalheEmpresa.numero, detalheEmpresa.bairro, detalheEmpresa.municipio, detalheEmpresa.uf, 'Brasil'].filter(Boolean).join(', '))}&output=embed&zoom=15`}
                        loading="lazy"
                        className="w-full h-40 border-0"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Seção: Certificado A1 */}
              <div className="px-6 py-5 border-b border-border/60">
                <div className="flex items-center gap-2 mb-4">
                  <SealCheckIcon size={14} className="text-primary" weight="fill" />
                  <span className="text-[11px] font-bold text-primary uppercase tracking-widest">Certificado A1</span>
                </div>
                {(() => {
                  const raiz = getRaiz(detalheEmpresa.cnpj);
                  const cert = certMap[raiz];
                  if (loadingCerts) return <p className="text-sm text-muted-foreground">Carregando...</p>;
                  if (!cert) return (
                    <div className="p-3 rounded-lg bg-muted/40 border border-border">
                      <p className="text-sm text-muted-foreground">Nenhum certificado associado</p>
                    </div>
                  );
                  const isValido = cert.status === 'ATIVO' || cert.status === 'VALIDO';
                  const isVencendo = cert.status === 'EXPIRACAO_PROXIMA' || cert.status === 'VENCENDO';
                  return (
                    <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/20">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${isValido ? 'bg-emerald-500' : isVencendo ? 'bg-amber-500' : 'bg-red-500'}`} />
                          <span className={`text-sm font-semibold ${isValido ? 'text-emerald-700' : isVencendo ? 'text-amber-700' : 'text-red-700'}`}>
                            Status: {isValido ? 'Válido' : isVencendo ? 'Vencendo' : 'Vencido'}
                          </span>
                        </div>
                        {cert.validade && (
                          <p className="text-xs text-muted-foreground mt-0.5">Vencimento: {fmtDate(cert.validade)}</p>
                        )}
                      </div>
                      <button type="button" onClick={() => router.push('/certificados')}
                        className="px-3 py-1.5 rounded-lg border border-input text-sm font-medium text-foreground hover:bg-muted transition-colors">
                        Renovar
                      </button>
                    </div>
                  );
                })()}
              </div>

              {/* Seção: Contatos */}
              {(detalheEmpresa.email || detalheEmpresa.telefone || detalheEmpresa.inscricaoEstadual || detalheEmpresa.inscricaoMunicipal) && (
                <div className="px-6 py-5">
                  <div className="flex items-center gap-2 mb-4">
                    <EnvelopeSimpleIcon size={14} className="text-primary" weight="fill" />
                    <span className="text-[11px] font-bold text-primary uppercase tracking-widest">Contatos</span>
                  </div>
                  <div className="space-y-3">
                    {(detalheEmpresa.email || detalheEmpresa.telefone) && (
                      <div className="grid grid-cols-2 gap-3">
                        {detalheEmpresa.email && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">E-mail</p>
                            <p className="text-sm font-medium text-foreground truncate">{detalheEmpresa.email}</p>
                          </div>
                        )}
                        {detalheEmpresa.telefone && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Telefone</p>
                            <p className="text-sm font-medium text-foreground">{detalheEmpresa.telefone}</p>
                          </div>
                        )}
                      </div>
                    )}
                    {(detalheEmpresa.inscricaoEstadual || detalheEmpresa.inscricaoMunicipal) && (
                      <div className="grid grid-cols-2 gap-3">
                        {detalheEmpresa.inscricaoEstadual && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Inscrição Estadual</p>
                            <p className="text-sm font-medium text-foreground">{detalheEmpresa.inscricaoEstadual}</p>
                          </div>
                        )}
                        {detalheEmpresa.inscricaoMunicipal && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Inscrição Municipal</p>
                            <p className="text-sm font-medium text-foreground">{detalheEmpresa.inscricaoMunicipal}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>{/* end scrollable body */}

            {/* ── Footer ── */}
            <div className="px-6 py-4 border-t border-border bg-muted/30 flex items-center gap-3 shrink-0">
              <button type="button" onClick={() => { setShowDetalheModal(false); abrirEdicaoEmpresa(detalheEmpresa); }}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 active:scale-95 transition-all">
                  <PencilSimpleIcon size={14} /> Editar Dados
                </button>
              <button type="button" onClick={() => setShowDetalheModal(false)}
                className="flex-1 inline-flex items-center justify-center px-4 py-2.5 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors">
                Fechar
              </button>
            </div>

          </div>{/* end panel */}
        </>
      )}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
