'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BuildingsIcon, CaretRightIcon, CaretDownIcon, PlusIcon, PencilSimpleIcon, UserMinusIcon,
  UsersIcon, ArrowClockwiseIcon, ShieldCheckIcon, ToggleLeftIcon, MagnifyingGlassIcon, XIcon,
} from '@phosphor-icons/react';
import { Modal } from '@/components/ui/modal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast, ToastContainer } from '@/components/ui/toast';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

type TipoUnidade = 'UA' | 'UG';

const TIPO_META: Record<TipoUnidade, { label: string; color: string; badgeCls: string; leftBorder: string; selectedBg: string }> = {
  UA: { label: 'Unidade Administrativa', color: 'bg-primary/10 text-primary',   badgeCls: 'bg-primary/10 text-primary',   leftBorder: 'border-primary',    selectedBg: 'bg-primary/10'},
  UG: { label: 'Unidade Gestora',        color: 'bg-violet-50 text-violet-700', badgeCls: 'bg-violet-100 text-violet-700', leftBorder: 'border-violet-400', selectedBg: 'bg-violet-50' },
};

interface UsuarioMembro {
  usuarioId: string;
  principal?: boolean;
  usuario: { nome: string; role: string };
}

interface Unidade {
  id: string;
  nome: string;
  sigla?: string;
  tipo: TipoUnidade;
  ativo: boolean;
  paiId?: string;
  responsavelId?: string;
  responsavel?: { id: string; nome: string; email?: string };
  pai?: { id: string; nome: string };
  dataVigenciaInicio?: string;
  dataVigenciaFim?: string;
  usuarios?: UsuarioMembro[];
  filhos?: Unidade[];
  visibilidadesOrigem?: Array<{ alvoId: string; alvo: Unidade & { tipo: TipoUnidade } }>;
  _count: { usuarios: number; filhos: number };
}

interface UnidadeNode extends Unidade {
  filhosArvore: UnidadeNode[];
}

interface UsuarioItem { id: string; nome: string; email: string; role: string; }

type ModalMode = 'criar' | 'editar' | null;

interface FormState {
  nome: string; sigla: string; tipo: TipoUnidade; responsavelId: string;
  paiId: string; dataVigenciaInicio: string; dataVigenciaFim: string; ativo: boolean;
}

const FORM_VAZIO: FormState = {
  nome: '', sigla: '', tipo: 'UG', responsavelId: '',
  paiId: '', dataVigenciaInicio: '', dataVigenciaFim: '', ativo: true,
};

function getUser() {
  if (typeof globalThis.window === 'undefined') return null;
  try { return JSON.parse(localStorage.getItem('selene_usuario') ?? 'null'); } catch { return null; }
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR');
}

function InfoCard({ label, value, sub }: Readonly<{ label: string; value: string; sub?: string }>) {
  return (
    <div className="rounded-lg border border-border bg-muted/50 px-4 py-3">
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

const DEPTH_PL = ['pl-2', 'pl-6', 'pl-10', 'pl-14', 'pl-[4.5rem]', 'pl-[5.5rem]'] as const;

interface ArvoreNodeProps {
  readonly node: UnidadeNode;
  readonly selectedId?: string;
  readonly depth: number;
  readonly onSelect: (u: Unidade) => void;
  readonly onCriarFilho?: (paiId: string) => void;
  readonly onEditar?: (u: Unidade) => void;
  readonly onInativar?: (u: Unidade) => void;
}

function ArvoreNode({ node, selectedId, depth, onSelect, onCriarFilho, onEditar, onInativar }: ArvoreNodeProps) {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasFilhos = node.filhosArvore.length > 0;
  const isSelected = selectedId === node.id;
  const meta = TIPO_META[node.tipo];
  const depthPl = DEPTH_PL[Math.min(depth, DEPTH_PL.length - 1)];

  return (
    <div>
      <div className={`group flex items-center rounded-lg mb-0.5 transition-all border-l-4 ${depthPl} ${
        isSelected ? `${meta.leftBorder} ${meta.selectedBg}` : 'border-l-transparent bg-card hover:bg-muted'
      } ${node.ativo ? '' : 'opacity-50'}`}>
        <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          aria-label={expanded ? 'Recolher' : 'Expandir'}
          className="shrink-0 p-1 text-muted-foreground hover:text-muted-foreground transition-colors">
          {!hasFilhos && <span className="w-3 inline-block" />}
          {hasFilhos && (expanded ? <CaretDownIcon size={13} /> : <CaretRightIcon size={13} />)}
        </button>
        <button type="button" onClick={() => onSelect(node)} className="flex-1 flex items-center gap-2.5 py-2.5 min-w-0 text-left focus:outline-none">
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${meta.color}`}>
            <BuildingsIcon size={14} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-medium text-sm text-foreground truncate">{node.nome}</span>
              {node.sigla && <span className="text-[10px] font-mono text-muted-foreground">[{node.sigla}]</span>}
              <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full ${meta.badgeCls}`}>{node.tipo}</span>
            </div>
            {node.responsavel && <p className="text-xs text-muted-foreground truncate mt-0.5">{node.responsavel.nome}</p>}
            <div className="flex items-center gap-1 mt-1">
              <UsersIcon size={10} className="text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{node._count.usuarios} membro(s)</span>
            </div>
          </div>
        </button>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pr-2">
          {onCriarFilho && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onCriarFilho(node.id); }}
              className="p-1 rounded text-muted-foreground hover:text-emerald-500 hover:bg-emerald-50 transition-colors" title="Adicionar sub-unidade" aria-label="Adicionar sub-unidade">
              <PlusIcon size={11} />
            </button>
          )}
          {onEditar && node.ativo && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onEditar(node); }}
              className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors" title="Editar" aria-label="Editar unidade">
              <PencilSimpleIcon size={11} />
            </button>
          )}
          {onInativar && node.ativo && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onInativar(node); }}
              className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors" title="Inativar" aria-label="Inativar unidade">
              <ToggleLeftIcon size={11} />
            </button>
          )}
        </div>
      </div>
      {hasFilhos && expanded && (
        <div>
          {node.filhosArvore.map((filho) => (
            <ArvoreNode key={filho.id} node={filho} selectedId={selectedId} depth={depth + 1}
              onSelect={onSelect} onCriarFilho={onCriarFilho} onEditar={onEditar} onInativar={onInativar} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function UnidadesPage() {
  const [podeEditar, setPodeEditar] = useState(false);
  const [podeCriar, setPodeCriar] = useState(false);

  useEffect(() => {
    const u = getUser();
    const can = u?.role === 'ADMIN' || u?.role === 'GESTOR';
    setPodeEditar(can);
    setPodeCriar(can);
  }, []);

  const { toasts, success, error: toastError, dismiss } = useToast();

  const [arvore, setArvore] = useState<UnidadeNode[]>([]);
  const [lista, setLista] = useState<Unidade[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Unidade | null>(null);
  const [detalhes, setDetalhes] = useState<Unidade | null>(null);
  const [loadingDet, setLoadingDet] = useState(false);

  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(FORM_VAZIO);
  const [inativarTarget, setInativarTarget] = useState<Unidade | null>(null);

  const [usuarios, setUsuarios] = useState<UsuarioItem[]>([]);
  const [addMembroId, setAddMembroId] = useState('');

  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<TipoUnidade | ''>('');

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const [arvoreRes, listaRes] = await Promise.all([
        api.get('/unidades-organizacionais/arvore').catch(() => api.get('/unidades-organizacionais')),
        api.get('/unidades-organizacionais'),
      ]);
      const listaData: Unidade[] = listaRes.data?.data ?? listaRes.data ?? [];
      setLista(listaData);
      const arvData = arvoreRes.data?.data ?? arvoreRes.data ?? [];
      if (Array.isArray(arvData) && arvData.length > 0 && 'filhosArvore' in arvData[0]) {
        setArvore(arvData as UnidadeNode[]);
      } else {
        const map = new Map<string, UnidadeNode>();
        const allNodes = listaData.map((u) => ({ ...u, filhosArvore: [] as UnidadeNode[] }));
        allNodes.forEach((n) => map.set(n.id, n));
        const roots: UnidadeNode[] = [];
        allNodes.forEach((n) => {
          if (n.paiId && map.has(n.paiId)) {
            map.get(n.paiId)!.filhosArvore.push(n);
          } else {
            roots.push(n);
          }
        });
        setArvore(roots);
      }
    } catch {
      toastError('Erro ao carregar unidades.');
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const carregarUsuarios = useCallback(async () => {
    try {
      const res = await api.get('/usuarios?limit=500');
      const d = res.data;
      setUsuarios(d.data ?? d ?? []);
    } catch {
      toastError('Erro ao carregar lista de usuários.');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void carregar(); void carregarUsuarios(); }, [carregar, carregarUsuarios]);

  const selecionarUnidade = async (u: Unidade) => {
    if (selected?.id === u.id) { setSelected(null); setDetalhes(null); return; }
    setSelected(u);
    setLoadingDet(true);
    try {
      const res = await api.get(`/unidades-organizacionais/${u.id}`);
      setDetalhes(res.data);
    } catch { toastError('Erro ao carregar detalhes.'); }
    finally { setLoadingDet(false); }
  };

  const abrirCriar = (paiPreSelecionado?: string) => {
    setForm({ ...FORM_VAZIO, paiId: paiPreSelecionado ?? '' });
    setModalMode('criar');
  };

  const abrirEditar = (u: Unidade) => {
    setForm({
      nome: u.nome, sigla: u.sigla ?? '', tipo: u.tipo,
      responsavelId: u.responsavelId ?? '', paiId: u.paiId ?? '',
      dataVigenciaInicio: u.dataVigenciaInicio ? u.dataVigenciaInicio.slice(0, 10) : '',
      dataVigenciaFim: u.dataVigenciaFim ? u.dataVigenciaFim.slice(0, 10) : '',
      ativo: u.ativo,
    });
    setSelected(u);
    setModalMode('editar');
  };

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nome.trim()) return;
    setSaving(true);
    try {
      const payload = {
        nome: form.nome.trim(), sigla: form.sigla.trim() || undefined, tipo: form.tipo,
        responsavelId: form.responsavelId || undefined, paiId: form.paiId || undefined,
        dataVigenciaInicio: form.dataVigenciaInicio || undefined, dataVigenciaFim: form.dataVigenciaFim || undefined,
        ativo: form.ativo,
      };
      if (modalMode === 'criar') {
        await api.post('/unidades-organizacionais', payload);
        success('Unidade criada com sucesso!');
      } else if (selected) {
        await api.patch(`/unidades-organizacionais/${selected.id}`, payload);
        success('Unidade atualizada!');
      }
      setModalMode(null);
      void carregar();
    } catch {
      toastError(modalMode === 'criar' ? 'Erro ao criar unidade.' : 'Erro ao atualizar unidade.');
    } finally { setSaving(false); }
  };

  const handleInativar = async () => {
    if (!inativarTarget) return;
    try {
      await api.patch(`/unidades-organizacionais/${inativarTarget.id}`, { ativo: false });
      success('Unidade inativada.');
      setInativarTarget(null);
      if (selected?.id === inativarTarget.id) { setSelected(null); setDetalhes(null); }
      void carregar();
    } catch { toastError('Erro ao inativar unidade.'); }
  };

  const handleAdicionarMembro = async () => {
    if (!selected || !addMembroId) return;
    try {
      await api.post(`/unidades-organizacionais/${selected.id}/usuarios`, { usuarioId: addMembroId });
      success('Usuário adicionado!');
      setAddMembroId('');
      const res = await api.get(`/unidades-organizacionais/${selected.id}`);
      setDetalhes(res.data);
    } catch { toastError('Erro ao adicionar membro.'); }
  };

  const handleRemoverMembro = async (usuarioId: string) => {
    if (!selected) return;
    try {
      await api.delete(`/unidades-organizacionais/${selected.id}/usuarios/${usuarioId}`);
      success('Usuário removido.');
      const res = await api.get(`/unidades-organizacionais/${selected.id}`);
      setDetalhes(res.data);
    } catch { toastError('Erro ao remover membro.'); }
  };

  const membrosIds = useMemo(
    () => new Set((detalhes?.usuarios ?? []).map((m) => m.usuarioId)),
    [detalhes?.usuarios],
  );
  const usuariosDisponiveis = useMemo(
    () => usuarios.filter((u) => !membrosIds.has(u.id)),
    [usuarios, membrosIds],
  );

  const filtroAtivo = filtroTexto.trim() !== '' || filtroTipo !== '';
  const listaFiltrada = useMemo(() => {
    if (!filtroAtivo) return [];
    const txt = filtroTexto.trim().toLowerCase();
    return lista.filter((u) => {
      const matchTexto = !txt || u.nome.toLowerCase().includes(txt) || (u.sigla?.toLowerCase().includes(txt) ?? false);
      const matchTipo = !filtroTipo || u.tipo === filtroTipo;
      return matchTexto && matchTipo;
    });
  }, [lista, filtroTexto, filtroTipo, filtroAtivo]);

  const selectedMeta = selected ? TIPO_META[selected.tipo] : null;
  const selectCls = 'w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors';

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0 h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Unidades Organizacionais</h1>
          <p className="text-sm text-muted-foreground mt-1">Organograma hierárquico de UA/UG com responsáveis e vigência.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void carregar()} aria-label="Recarregar unidades"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors">
            <ArrowClockwiseIcon size={15} />
          </button>
          {podeCriar && (
            <button type="button" onClick={() => abrirCriar()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
              <PlusIcon size={15} /> Nova Unidade
            </button>
          )}
        </div>
      </div>

      <div className="bg-card rounded-lg border border-border shadow-sm flex flex-1 min-h-0 overflow-hidden">
        {/* LEFT: Árvore */}
        <div className="w-80 shrink-0 min-h-0 border-r border-input flex flex-col bg-muted/40">
          <div className="px-3 py-3 border-b border-border space-y-2">
            <div className="relative">
              <MagnifyingGlassIcon size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input type="search" placeholder="Buscar nome, sigla..." value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)}
                aria-label="Buscar unidades"
                className="w-full pl-7 pr-7 py-2 text-sm rounded-lg border border-input bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary placeholder:text-muted-foreground transition-colors" />
              {filtroTexto && (
                <button type="button" onClick={() => setFiltroTexto('')} aria-label="Limpar busca"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground">
                  <XIcon size={12} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1">
              {(['', 'UA', 'UG'] as const).map((t) => (
                <button key={t || 'todos'} type="button" onClick={() => setFiltroTipo(t)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${filtroTipo === t ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-muted'}`}>
                  {t || 'Todos'}
                </button>
              ))}
              <span className="ml-auto text-xs text-muted-foreground">
                {filtroAtivo ? `${listaFiltrada.length} resultado(s)` : `${lista.length} unidade(s)`}
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loading && ['a', 'b', 'c'].map((k) => (
              <div key={k} className="h-16 rounded-lg bg-muted animate-pulse" />
            ))}
            {!loading && filtroAtivo && listaFiltrada.length === 0 && (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
                <MagnifyingGlassIcon size={28} className="opacity-20" />Nenhum resultado.
              </div>
            )}
            {!loading && filtroAtivo && listaFiltrada.map((u) => {
              const meta = TIPO_META[u.tipo];
              const isSelected = selected?.id === u.id;
              return (
                <button key={u.id} type="button" onClick={() => void selecionarUnidade(u)}
                  className={`group w-full text-left rounded-lg border-l-4 p-3.5 transition-all ${isSelected ? `${meta.leftBorder} ${meta.selectedBg}` : 'border-l-transparent bg-card hover:bg-muted'} ${u.ativo ? '' : 'opacity-50'}`}>
                  <div className="flex items-start gap-3">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${meta.color}`}>
                      <BuildingsIcon size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-sm text-foreground truncate">{u.nome}</span>
                        {u.sigla && <span className="text-[10px] font-mono text-muted-foreground">[{u.sigla}]</span>}
                        <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full ${meta.badgeCls}`}>{u.tipo}</span>
                      </div>
                      {u.responsavel && <p className="text-xs text-muted-foreground truncate mt-0.5">{u.responsavel.nome}</p>}
                    </div>
                  </div>
                </button>
              );
            })}
            {!loading && !filtroAtivo && arvore.length === 0 && (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
                <BuildingsIcon size={28} className="opacity-20" />Nenhuma unidade cadastrada.
              </div>
            )}
            {!loading && !filtroAtivo && arvore.map((node) => (
              <ArvoreNode key={node.id} node={node} selectedId={selected?.id} depth={0}
                onSelect={selecionarUnidade}
                onCriarFilho={podeCriar ? (id) => abrirCriar(id) : undefined}
                onEditar={podeEditar ? abrirEditar : undefined}
                onInativar={podeEditar ? setInativarTarget : undefined}
              />
            ))}
          </div>

          {podeCriar && (
            <div className="p-3 border-t border-border">
              <button type="button" onClick={() => abrirCriar()}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed border-input text-sm text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5 transition-colors">
                <PlusIcon size={14} /> Nova Unidade Raiz
              </button>
            </div>
          )}
        </div>

        {/* RIGHT: Detalhes */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {selected && detalhes ? (
            <div className="p-6 flex flex-col h-full overflow-hidden">
              <div className="shrink-0 flex items-start justify-between pb-5 border-b border-border mb-6">
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${selectedMeta?.color ?? 'bg-muted text-muted-foreground'}`}>
                    <BuildingsIcon size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-foreground">{selected.nome}</h2>
                      {selected.sigla && <span className="text-xs font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{selected.sigla}</span>}
                      {!selected.ativo && <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">Inativa</span>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {selected.pai ? <>Vinculada a: <strong className="text-muted-foreground">{selected.pai.nome}</strong></> : 'Unidade raiz da hierarquia'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 mt-1">
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${selectedMeta?.badgeCls ?? 'bg-muted text-muted-foreground'}`}>{selected.tipo}</span>
                  {podeEditar && (
                    <>
                      <button type="button" onClick={() => abrirEditar(selected)} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-input text-foreground text-xs font-medium hover:bg-muted transition-colors">
                        <PencilSimpleIcon size={13} /> Editar
                      </button>
                      {selected.ativo && (
                        <button type="button" onClick={() => setInativarTarget(selected)} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-input text-foreground text-xs font-medium hover:bg-muted transition-colors">
                          <ToggleLeftIcon size={13} /> Inativar
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pr-2">
                <div className="grid grid-cols-2 gap-4">
                  <InfoCard label="Responsável" value={selected.responsavel?.nome ?? '—'} sub={selected.responsavel?.email} />
                  <InfoCard label="Tipo" value={selectedMeta?.label ?? selected.tipo} />
                  <InfoCard label="Vigência" value={selected.dataVigenciaInicio || selected.dataVigenciaFim ? `${fmtDate(selected.dataVigenciaInicio)} → ${fmtDate(selected.dataVigenciaFim)}` : '—'} />
                  <InfoCard label="Sub-unidades" value={String(detalhes._count.filhos)} />
                </div>

                {/* Membros */}
                <div className="rounded-lg border border-input shadow-sm overflow-hidden">
                  <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${selectedMeta?.color ?? 'bg-muted text-muted-foreground'}`}>
                        <UsersIcon size={15} />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">Membros</h3>
                        <p className="text-xs text-muted-foreground">{detalhes.usuarios?.length ?? 0} membro(s) ativos</p>
                      </div>
                    </div>
                    {podeEditar && (
                      <div className="flex items-center gap-2">
                        <select value={addMembroId} onChange={(e) => setAddMembroId(e.target.value)}
                          aria-label="Selecionar membro para adicionar"
                          className="text-sm rounded-lg border border-input px-2 py-1.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary max-w-[200px]">
                          <option value="">Adicionar membro...</option>
                          {usuariosDisponiveis.map((u) => (<option key={u.id} value={u.id}>{u.nome}</option>))}
                        </select>
                        <button type="button" disabled={!addMembroId} onClick={() => void handleAdicionarMembro()}
                          aria-label="Confirmar adição de membro"
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
                          <PlusIcon size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="p-5">
                    {loadingDet && (
                      <div className="flex gap-4">
                        {['a', 'b', 'c'].map((k) => (
                          <div key={k} className="flex flex-col items-center gap-2">
                            <div className="h-12 w-12 rounded-full bg-muted animate-pulse" />
                            <div className="h-3 w-14 rounded bg-muted animate-pulse" />
                          </div>
                        ))}
                      </div>
                    )}
                    {!loadingDet && (detalhes.usuarios?.length ?? 0) === 0 && (
                      <div className="flex flex-col items-center justify-center py-6 text-muted-foreground gap-2">
                        <UserMinusIcon size={24} className="opacity-30" />
                        <p className="text-sm">Nenhum membro nesta unidade.</p>
                      </div>
                    )}
                    {!loadingDet && (detalhes.usuarios?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-5">
                        {detalhes.usuarios!.map((m) => (
                          <div key={m.usuarioId} className="relative group flex flex-col items-center gap-1.5">
                            <div className={`relative h-12 w-12 rounded-full flex items-center justify-center font-bold text-base ring-2 ring-white shadow-sm ${selectedMeta?.color ?? 'bg-muted text-muted-foreground'}`}>
                              {m.usuario.nome.charAt(0).toUpperCase()}
                              {m.principal && (
                                <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-primary flex items-center justify-center" title="Principal">
                                  <ShieldCheckIcon size={9} className="text-white" />
                                </span>
                              )}
                              {podeEditar && (
                                <button type="button" onClick={() => void handleRemoverMembro(m.usuarioId)}
                                  className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow"
                                  title="Remover membro" aria-label={`Remover ${m.usuario.nome}`}>
                                  <UserMinusIcon size={9} />
                                </button>
                              )}
                            </div>
                            <div className="text-center">
                              <p className="text-xs font-medium text-foreground leading-tight max-w-[72px] truncate">{m.usuario.nome.split(' ')[0]}</p>
                              <p className="text-[10px] text-muted-foreground leading-tight">{m.usuario.role}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Sub-unidades diretas */}
                {(detalhes.filhos?.length ?? 0) > 0 && (
                  <div className="rounded-lg border border-input shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-border bg-muted/40 flex items-center gap-2">
                      <BuildingsIcon size={14} className="text-muted-foreground" />
                      <span className="text-sm font-semibold text-foreground">Sub-unidades diretas ({detalhes.filhos!.length})</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {detalhes.filhos!.map((f) => {
                        const fm = TIPO_META[f.tipo];
                        return (
                          <button type="button" key={f.id} onClick={() => void selecionarUnidade(f)}
                            className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-muted transition-colors">
                            <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${fm.color}`}>
                              <BuildingsIcon size={14} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-medium text-foreground">{f.nome}</span>
                                {f.sigla && <span className="text-xs text-muted-foreground font-mono">[{f.sigla}]</span>}
                                <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full ${fm.badgeCls}`}>{f.tipo}</span>
                              </div>
                              {f.responsavel && <p className="text-xs text-muted-foreground">{f.responsavel.nome}</p>}
                            </div>
                            <span className="text-xs text-muted-foreground">{f._count.usuarios} membro(s)</span>
                            <CaretRightIcon size={14} className="text-muted-foreground" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
              <BuildingsIcon size={48} className="opacity-10" />
              <div className="text-center">
                <p className="text-sm font-medium text-muted-foreground">Selecione uma unidade</p>
                <p className="text-xs text-muted-foreground mt-1">Clique em uma unidade para ver detalhes, membros e sub-unidades</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal criar/editar */}
      <Modal isOpen={modalMode === 'criar' || modalMode === 'editar'} onClose={() => setModalMode(null)}
        title={modalMode === 'criar' ? 'Nova Unidade Organizacional' : 'Editar Unidade'} size="xl">
        <form onSubmit={(e) => void handleSalvar(e)} className="space-y-5">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-bold text-primary uppercase tracking-wider">Identificação</span>
              <div className="flex-1 border-t border-border" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Input id="nome" label="Nome *" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex: Diretoria de Contratos" required />
              </div>
              <Input id="sigla" label="Sigla" value={form.sigla} onChange={(e) => setForm({ ...form, sigla: e.target.value.toUpperCase() })} placeholder="DIRC" maxLength={20} />
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-bold text-primary uppercase tracking-wider">Hierarquia e Responsável</span>
              <div className="flex-1 border-t border-border" />
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label htmlFor="tipo" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Tipo *</label>
                <select id="tipo" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoUnidade })} className={selectCls}>
                  <option value="UA">UA — Unidade Administrativa</option>
                  <option value="UG">UG — Unidade Gestora</option>
                </select>
              </div>
              <div>
                <label htmlFor="paiId" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Unidade Pai</label>
                <select id="paiId" value={form.paiId} onChange={(e) => setForm({ ...form, paiId: e.target.value })} className={selectCls}>
                  <option value="">(Raiz — sem hierarquia superior)</option>
                  {lista.filter((u) => u.ativo && (modalMode !== 'editar' || u.id !== selected?.id)).map((u) => (
                    <option key={u.id} value={u.id}>{u.nome}{u.sigla ? ` [${u.sigla}]` : ''}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="responsavelId" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Responsável (Diretor)</label>
              <select id="responsavelId" value={form.responsavelId} onChange={(e) => setForm({ ...form, responsavelId: e.target.value })} className={selectCls}>
                <option value="">Nenhum responsável definido</option>
                {usuarios.map((u) => (<option key={u.id} value={u.id}>{u.nome}</option>))}
              </select>
            </div>
          </div>

          <div>
            <p className="text-sm font-bold text-primary uppercase tracking-wider mb-3">Vigência</p>
            <div className="grid grid-cols-2 gap-3">
              <Input id="vigenciaInicio" label="Início" type="date" value={form.dataVigenciaInicio} onChange={(e) => setForm({ ...form, dataVigenciaInicio: e.target.value })} />
              <Input id="vigenciaFim" label="Fim" type="date" value={form.dataVigenciaFim} onChange={(e) => setForm({ ...form, dataVigenciaFim: e.target.value })} />
            </div>
          </div>

          {modalMode === 'editar' && (
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <span className={`h-4 w-4 shrink-0 rounded flex items-center justify-center border transition-colors ${form.ativo ? 'bg-primary border-primary' : 'border-input bg-card'}`}>
                {form.ativo && <svg viewBox="0 0 10 8" className="w-2.5 h-2 text-white" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="1,4 4,7 9,1" /></svg>}
              </span>
              <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} className="sr-only" />
              <span className="text-sm text-foreground">Unidade ativa</span>
            </label>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-border">
            <button type="button" onClick={() => setModalMode(null)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors">Cancelar</button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
              {saving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : null}
              {modalMode === 'criar' ? 'Criar' : 'Salvar'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!inativarTarget}
        title="Inativar Unidade"
        message={`Inativar "${inativarTarget?.nome}"? Membros não serão alterados.`}
        confirmLabel="Sim, inativar"
        onConfirm={() => void handleInativar()}
        onCancel={() => setInativarTarget(null)}
      />

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
