'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArrowClockwise,
  UploadSimple,
  FilePdf,
  MagnifyingGlass,
  Seal,
  Warning,
  CheckCircle,
  X,
  CaretLeft,
  CaretRight,
  Eye,
  EyeSlash,
  FileArrowUp,
  Buildings,
} from '@phosphor-icons/react';
import { api } from '@/lib/api';
import { useToast, ToastContainer } from '@/components/ui/toast';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

interface Certificado {
  id: string;
  cnpj: string;
  razaoSocial: string;
  validade: string; // ISO date string
  status: 'ATIVO' | 'EXPIRACAO_PROXIMA' | 'VENCIDO' | 'REVOGADO';
  empresa?: {
    id: string;
    razaoSocial: string;
    cnpj: string;
  };
  thumbprint?: string;
  issuer?: string;
  subject?: string;
  createdAt?: string;
  updatedAt?: string;
}

type WizardStep = 1 | 2 | 3;

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function maskCnpj(v: string | null | undefined) {
  const d = (v ?? '').replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function formatDate(iso: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR');
}

function daysUntil(iso: string): number {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 0;
  const diff = d.getTime() - Date.now();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/* ------------------------------------------------------------------ */
/* Status Badge                                                         */
/* ------------------------------------------------------------------ */

function StatusBadge({ status, validade }: { status: string; validade: string }) {
  const dias = daysUntil(validade);
  if (status === 'ATIVO' || status === 'VALIDO') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
        <CheckCircle size={12} weight="fill" />
        Válido
      </span>
    );
  }
  if (status === 'EXPIRACAO_PROXIMA' || status === 'VENCENDO') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
        <Warning size={12} weight="fill" />
        Vencendo em {dias}d
      </span>
    );
  }
  if (status === 'REVOGADO') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
        <Warning size={12} weight="fill" />
        Revogado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
      <Warning size={12} weight="fill" />
      Vencido
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Upload Wizard Modal                                                  */
/* ------------------------------------------------------------------ */

interface WizardModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function WizardModal({ onClose, onSuccess }: WizardModalProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [certPreview, setCertPreview] = useState<{ subject?: string; issuer?: string; validade?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { success, error: toastError, toasts, dismiss } = useToast();

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !uploading) onClose();
    },
    [onClose, uploading],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [handleEscape]);

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped && (dropped.name.endsWith('.pfx') || dropped.name.endsWith('.p12'))) {
      setFile(dropped);
      setUploadError('');
    } else {
      setUploadError('Apenas arquivos .pfx ou .p12 são aceitos.');
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setUploadError('');
    }
  }

  async function handleStep2Submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) {
      setUploadError('Informe a senha do certificado.');
      return;
    }
    // Optionally: preview cert info via POST /certificados/preview
    // For now, skip to confirm step
    setUploadError('');
    setStep(3);
  }

  async function handleUpload() {
    if (!file || !password) return;
    setUploading(true);
    setUploadError('');
    try {
      // Passo 1: validar e criar rascunho
      const formData = new FormData();
      formData.append('file', file);
      formData.append('password', password);
      const validar = await api.post('/certificados/validar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      if (!validar.data?.success) {
        setUploadError(validar.data?.errorMessage ?? 'Erro ao validar certificado.');
        return;
      }

      const certificadoId: string = validar.data.certificado.id;
      const raizCnpj: string = validar.data.certificado.raizCnpj;

      // Passo 2: buscar empresas do tenant com essa raiz de CNPJ
      const empRes = await api.get(`/certificados/empresas/${raizCnpj}`);
      const empresaIds: string[] = (empRes.data ?? []).map((e: { id: string }) => e.id);

      // Passo 3: finalizar associação
      await api.post('/certificados', { certificadoId, empresaIds });

      success('Certificado importado com sucesso!');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 800);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Erro ao importar certificado.';
      setUploadError(msg);
    } finally {
      setUploading(false);
    }
  }

  const stepLabels: Record<WizardStep, string> = {
    1: 'Selecionar arquivo',
    2: 'Informar senha',
    3: 'Confirmar importação',
  };

  const STEPS = [
    { n: 1 as WizardStep, label: 'Selecionar arquivo', sub: 'Arquivo .pfx ou .p12' },
    { n: 2 as WizardStep, label: 'Senha do certificado', sub: 'Proteção do arquivo' },
    { n: 3 as WizardStep, label: 'Confirmar importação', sub: 'Revisar e concluir' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={() => !uploading && onClose()}
      />
      <div className="relative z-10 w-full max-w-xl bg-card rounded-lg shadow-2xl overflow-hidden border border-border">

        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileArrowUp size={18} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground leading-tight">Importar Certificado Digital A1</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Arquivo .pfx ou .p12 protegido por senha</p>
            </div>
          </div>
          <button
            title="Fechar"
            onClick={() => !uploading && onClose()}
            disabled={uploading}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        {/* Step tracker */}
        <div className="px-6 pt-5 pb-5 border-b border-border">
          <div className="flex items-start">
            {STEPS.map((s, idx) => {
              const done = step > s.n;
              const active = step === s.n;
              return (
                <React.Fragment key={s.n}>
                  <div className="flex flex-col items-center gap-2 shrink-0">
                    {/* círculo */}
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                      done    ? 'bg-primary text-white'
                      : active ? 'bg-primary text-white ring-4 ring-primary/15'
                      : 'bg-muted text-muted-foreground'
                    }`}>
                      {done
                        ? <CheckCircle size={14} weight="fill" />
                        : <span className="text-[11px] font-bold">{s.n}</span>
                      }
                    </div>
                    {/* label + sub */}
                    <div className="text-center">
                      <p className={`text-[11px] font-semibold leading-tight whitespace-nowrap ${
                        active ? 'text-primary' : done ? 'text-primary/70' : 'text-muted-foreground'
                      }`}>{s.label}</p>
                      <p className={`text-[10px] leading-tight whitespace-nowrap mt-0.5 ${
                        active ? 'text-muted-foreground' : 'text-muted-foreground/50'
                      }`}>{s.sub}</p>
                    </div>
                  </div>
                  {idx < 2 && (
                    <div className={`flex-1 h-px mt-3.5 mx-3 rounded-full transition-all ${done ? 'bg-primary/40' : 'bg-border'}`} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 min-h-[230px]">

          {/* ── Step 1: Arquivo ── */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Selecione o arquivo do certificado A1 no formato <span className="font-medium text-foreground">.pfx</span> ou <span className="font-medium text-foreground">.p12</span>.
              </p>

              {file ? (
                /* arquivo selecionado */
                <div className="flex items-center gap-4 p-4 rounded-lg bg-emerald-50 border border-emerald-200">
                  <div className="w-12 h-12 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                    <FilePdf size={26} weight="fill" className="text-emerald-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-emerald-800 truncate">{file.name}</p>
                    <p className="text-xs text-emerald-600 mt-0.5">{(file.size / 1024).toFixed(1)} KB · {file.name.split('.').pop()?.toUpperCase()}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setFile(null); fileInputRef.current && (fileInputRef.current.value = ''); }}
                    className="shrink-0 p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-100 hover:text-emerald-700 transition-colors"
                    title="Remover arquivo"
                  >
                    <X size={15} />
                  </button>
                </div>
              ) : (
                /* dropzone */
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="group relative border-2 border-dashed border-input rounded-lg p-10 text-center cursor-pointer hover:border-primary/60 hover:bg-primary/[0.02] transition-all"
                >
                  <input ref={fileInputRef} type="file" accept=".pfx,.p12" title="Selecionar arquivo de certificado (.pfx ou .p12)" className="hidden" onChange={handleFileChange} />
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-14 h-14 rounded-lg bg-muted group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                      <UploadSimple size={28} className="text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-muted-foreground group-hover:text-primary transition-colors">Arraste o arquivo aqui</p>
                      <p className="text-xs text-muted-foreground mt-1">ou clique para abrir o seletor</p>
                    </div>
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs font-medium">
                      .pfx · .p12
                    </span>
                  </div>
                </div>
              )}

              {uploadError && (
                <p className="flex items-center gap-1.5 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                  <Warning size={14} weight="fill" /> {uploadError}
                </p>
              )}
            </div>
          )}

          {/* ── Step 2: Senha ── */}
          {step === 2 && (
            <form onSubmit={handleStep2Submit} className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 border border-amber-100">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
                  <FilePdf size={16} weight="fill" className="text-amber-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-amber-800">Arquivo selecionado</p>
                  <p className="text-xs text-amber-700 mt-0.5 truncate font-mono">{file?.name}</p>
                  <p className="text-xs text-amber-600 mt-0.5">{file ? `${(file.size / 1024).toFixed(1)} KB` : ''}</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-foreground mb-2">
                  Senha de proteção <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Digite a senha do certificado"
                    autoFocus
                    className="w-full px-4 py-3 pr-11 rounded-lg border border-input text-sm bg-muted focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground transition-colors p-0.5"
                  >
                    {showPassword ? <EyeSlash size={17} /> : <Eye size={17} />}
                  </button>
                </div>
                {password && (
                  <div className="flex gap-1.5 mt-2">
                    {[1,2,3,4].map((i) => (
                      <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${password.length >= i * 3 ? 'bg-primary' : 'bg-muted'}`} />
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-2">A senha não é armazenada — é usada apenas para ler o certificado.</p>
              </div>

              {uploadError && (
                <p className="flex items-center gap-1.5 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                  <Warning size={14} weight="fill" /> {uploadError}
                </p>
              )}
              <button type="submit" title="Enviar" className="hidden" />
            </form>
          )}

          {/* ── Step 3: Confirmação ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 rounded-lg bg-primary/5 border border-primary/10">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Seal size={22} className="text-primary" weight="fill" />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">Pronto para importar</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Revise os dados abaixo antes de confirmar</p>
                </div>
              </div>

              <div className="rounded-lg border border-input divide-y divide-slate-100 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Arquivo</span>
                  <span className="text-sm font-medium text-foreground max-w-[60%] truncate text-right">{file?.name}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tamanho</span>
                  <span className="text-sm font-medium text-foreground">{file ? `${(file.size / 1024).toFixed(1)} KB` : '—'}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Formato</span>
                  <span className="text-sm font-medium text-foreground">{file?.name.split('.').pop()?.toUpperCase() ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Senha</span>
                  <span className="text-sm font-medium tracking-widest text-muted-foreground">{'•'.repeat(Math.min(password.length, 10))}</span>
                </div>
              </div>

              {certPreview && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-100 divide-y divide-emerald-100 overflow-hidden">
                  {certPreview.subject && (
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Titular</span>
                      <span className="text-sm font-medium text-emerald-900 max-w-[60%] truncate text-right">{certPreview.subject}</span>
                    </div>
                  )}
                  {certPreview.validade && (
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Validade</span>
                      <span className="text-sm font-bold text-emerald-700">{formatDate(certPreview.validade)}</span>
                    </div>
                  )}
                </div>
              )}

              {uploadError && (
                <p className="flex items-center gap-1.5 text-sm text-red-600 bg-red-50 px-3 py-2.5 rounded-lg border border-red-100">
                  <Warning size={14} weight="fill" /> {uploadError}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/60">
          <button
            type="button"
            onClick={() => { if (step === 1) onClose(); else setStep((s) => (s - 1) as WizardStep); }}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-input bg-card text-foreground text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            {step === 1 ? 'Cancelar' : <><CaretLeft size={14} /> Voltar</>}
          </button>

          <div className="flex items-center gap-2">
            {/* dots */}
            <div className="flex gap-1 mr-2">
              {[1,2,3].map((s) => (
                <div key={s} className={`h-1.5 rounded-full transition-all ${step === s ? 'w-4 bg-primary' : step > s ? 'w-1.5 bg-emerald-400' : 'w-1.5 bg-muted'}`} />
              ))}
            </div>

            {step < 3 ? (
              <button
                type="button"
                onClick={() => {
                  if (step === 1) {
                    if (!file) { setUploadError('Selecione um arquivo .pfx ou .p12.'); return; }
                    setUploadError(''); setStep(2);
                  } else if (step === 2) {
                    if (!password) { setUploadError('Informe a senha do certificado.'); return; }
                    setUploadError(''); setStep(3);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm shadow-primary/20"
              >
                Próximo <CaretRight size={14} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleUpload}
                disabled={uploading}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60 shadow-sm shadow-primary/20"
              >
                {uploading ? (
                  <><ArrowClockwise size={15} className="animate-spin" /> Importando…</>
                ) : (
                  <><UploadSimple size={15} /> Importar Certificado</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detail Panel                                                         */
/* ------------------------------------------------------------------ */

function CertDetalhe({ cert, onClose }: { cert: Certificado; onClose: () => void }) {
  return (
    <div className="bg-card rounded-lg border border-input p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-foreground text-sm">Detalhes do Certificado</h3>
        <button
          title="Fechar detalhes"
          onClick={onClose}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-muted-foreground hover:bg-muted transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
          <Seal size={24} className="text-primary" weight="fill" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground text-sm truncate">{cert.razaoSocial || cert.empresa?.razaoSocial || '—'}</p>
          <p className="text-xs text-muted-foreground font-mono">{maskCnpj(cert.cnpj)}</p>
        </div>
        <StatusBadge status={cert.status} validade={cert.validade} />
      </div>

      <div className="space-y-3 text-sm flex-1">
        <div className="bg-muted rounded-lg p-4 space-y-2">
          <Row label="Validade" value={formatDate(cert.validade)} highlight={cert.status === 'EXPIRACAO_PROXIMA' ? 'amber' : cert.status === 'VENCIDO' ? 'red' : 'green'} />
          <Row label="Dias restantes" value={cert.status === 'VENCIDO' ? 'Vencido' : `${Math.max(0, daysUntil(cert.validade))} dias`} />
          {cert.issuer && <Row label="Emissor" value={cert.issuer} />}
          {cert.subject && <Row label="Titular" value={cert.subject} />}
          {cert.thumbprint && (
            <div>
              <span className="text-muted-foreground text-xs">Thumbprint</span>
              <p className="font-mono text-xs text-muted-foreground break-all mt-0.5">{cert.thumbprint}</p>
            </div>
          )}
          {cert.createdAt && <Row label="Importado em" value={formatDate(cert.createdAt)} />}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: 'amber' | 'red' | 'green' }) {
  const colorClass = highlight === 'amber' ? 'text-amber-600' : highlight === 'red' ? 'text-red-600' : highlight === 'green' ? 'text-emerald-600' : 'text-foreground';
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground text-xs shrink-0">{label}</span>
      <span className={`text-xs font-medium ${colorClass} text-right`}>{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Page                                                            */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 20;

export default function CertificadosPage() {
  const [certs, setCerts] = useState<Certificado[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'TODOS' | 'ATIVO' | 'EXPIRACAO_PROXIMA' | 'VENCIDO'>('TODOS');
  const [page, setPage] = useState(1);
  const [showWizard, setShowWizard] = useState(false);
  const [selected, setSelected] = useState<Certificado | null>(null);
  const { toasts, success, error: toastError, dismiss } = useToast();

  const loadCerts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: unknown[] } | unknown[]>('/certificados');
      const raw: unknown[] = Array.isArray(res.data) ? res.data : (res.data as { data: unknown[] }).data ?? [];
      const list: Certificado[] = raw.map((c: unknown) => {
        const r = c as Record<string, unknown>;
        return {
          id: r.id as string,
          razaoSocial: (r.razaoSocial as string) ?? '',
          cnpj: (r.cnpjCert as string) ?? (r.cnpj as string) ?? '',
          validade: (r.dataValidade as string) ?? (r.validade as string) ?? '',
          status: (r.status as Certificado['status']) ?? 'ATIVO',
          thumbprint: (r.thumbprint as string) ?? '',
          issuer: (r.autoridadeCert as string) ?? (r.issuer as string),
          subject: (r.razaoSocial as string) ?? (r.subject as string),
          createdAt: (r.criadoEm as string) ?? (r.createdAt as string),
          empresa: r.empresas
            ? ((r.empresas as { empresa: { id: string; nome: string; cnpj: string } }[])[0]?.empresa
                ? {
                    id: (r.empresas as { empresa: { id: string; nome: string; cnpj: string } }[])[0].empresa.id,
                    razaoSocial: (r.empresas as { empresa: { id: string; nome: string; cnpj: string } }[])[0].empresa.nome,
                    cnpj: (r.empresas as { empresa: { id: string; nome: string; cnpj: string } }[])[0].empresa.cnpj,
                  }
                : undefined)
            : undefined,
        };
      });
      setCerts(list);
    } catch {
      toastError('Erro ao carregar certificados.');
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadCerts();
  }, [loadCerts]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const rawCnpj = search.replace(/\D/g, '');
    return certs.filter((c) => {
      const matchQ =
        !q ||
        c.razaoSocial?.toLowerCase().includes(q) ||
        c.cnpj?.includes(rawCnpj) ||
        c.empresa?.razaoSocial?.toLowerCase().includes(q);
      const matchStatus = filterStatus === 'TODOS' || c.status === filterStatus;
      return matchQ && matchStatus;
    });
  }, [certs, search, filterStatus]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const paginated = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  const stats = useMemo(() => ({
    validos:  certs.filter((c) => c.status === 'ATIVO').length,
    vencendo: certs.filter((c) => c.status === 'EXPIRACAO_PROXIMA').length,
    vencidos: certs.filter((c) => c.status === 'VENCIDO').length,
  }), [certs]);

  function handleSearchChange(v: string) {
    setSearch(v);
    setPage(1);
  }

  function handleStatusFilter(s: typeof filterStatus) {
    setFilterStatus(s);
    setPage(1);
  }

  const filterBtnClass = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
      active
        ? 'bg-primary text-primary-foreground border-primary'
        : 'bg-card text-muted-foreground border-input hover:bg-muted'
    }`;

  return (
    <div className="flex flex-col h-full gap-6">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Certificados Digitais A1</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Gerencie os certificados digitais utilizados na assinatura de documentos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadCerts}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            <ArrowClockwise size={16} className={loading ? 'animate-spin' : ''} />
            Atualizar
          </button>
          <button
            onClick={() => setShowWizard(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <UploadSimple size={16} />
            Importar Certificado
          </button>
        </div>
      </div>

      {/* Stats cards */}
      {!loading && certs.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total" value={certs.length} color="slate" onClick={() => handleStatusFilter('TODOS')} active={filterStatus === 'TODOS'} />
          <StatCard label="Válidos" value={stats.validos} color="emerald" onClick={() => handleStatusFilter('ATIVO')} active={filterStatus === 'ATIVO'} />
          <StatCard label="Vencendo" value={stats.vencendo} color="amber" onClick={() => handleStatusFilter('EXPIRACAO_PROXIMA')} active={filterStatus === 'EXPIRACAO_PROXIMA'} />
          <StatCard label="Vencidos" value={stats.vencidos} color="red" onClick={() => handleStatusFilter('VENCIDO')} active={filterStatus === 'VENCIDO'} />
        </div>
      )}

      {/* Content */}
      <div className={`flex gap-5 flex-1 min-h-0 ${selected ? 'flex-row' : ''}`}>
        {/* Left: list */}
        <div className={`flex flex-col gap-3 ${selected ? 'flex-1 min-w-0' : 'w-full'}`}>
          {/* Search & filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Buscar por razão social ou CNPJ…"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-input text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div className="flex items-center gap-1">
              {(['TODOS', 'ATIVO', 'EXPIRACAO_PROXIMA', 'VENCIDO'] as const).map((s) => (
                <button key={s} onClick={() => handleStatusFilter(s)} className={filterBtnClass(filterStatus === s)}>
                  {s === 'TODOS' ? 'Todos' : s === 'ATIVO' ? 'Válidos' : s === 'EXPIRACAO_PROXIMA' ? 'Vencendo' : 'Vencidos'}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="bg-card rounded-lg border border-border overflow-hidden flex-1">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead>Empresa / CNPJ</TableHead>
                  <TableHead>Validade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i} className="hover:bg-transparent">
                      {[1, 2, 3, 4].map((c) => (
                        <TableCell key={c}>
                          <div className={`h-4 bg-muted rounded animate-pulse ${c === 1 ? 'w-[70%]' : c === 2 ? 'w-1/2' : 'w-2/5'}`} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : paginated.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={4} className="py-16 text-center text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <Seal size={32} className="text-muted-foreground" />
                        <span className="text-sm">
                          {search || filterStatus !== 'TODOS'
                            ? 'Nenhum certificado encontrado para os filtros aplicados.'
                            : 'Nenhum certificado importado. Clique em "Importar Certificado" para começar.'}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginated.map((cert) => (
                    <TableRow
                      key={cert.id}
                      onClick={() => setSelected(selected?.id === cert.id ? null : cert)}
                      className={`cursor-pointer ${
                        selected?.id === cert.id
                          ? 'bg-primary/5 hover:bg-primary/5'
                          : 'hover:bg-muted/30'
                      }`}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <Seal size={16} className="text-primary" weight="fill" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground text-sm leading-tight">
                              {cert.razaoSocial || cert.empresa?.razaoSocial || '—'}
                            </p>
                            <p className="text-xs text-muted-foreground font-mono">{maskCnpj(cert.cnpj ?? cert.empresa?.cnpj)}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`text-sm font-medium ${
                            cert.status === 'VENCIDO'
                              ? 'text-red-600'
                              : cert.status === 'EXPIRACAO_PROXIMA'
                                ? 'text-amber-600'
                                : 'text-foreground'
                          }`}
                        >
                          {formatDate(cert.validade)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={cert.status} validade={cert.validade} />
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(selected?.id === cert.id ? null : cert);
                          }}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium border border-input text-muted-foreground hover:bg-muted transition-colors"
                        >
                          Detalhes
                        </button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

            {/* Pagination */}
            {!loading && filtered.length > PAGE_SIZE && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} de {filtered.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    title="Página anterior"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="p-1.5 rounded-lg border border-input text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40"
                  >
                    <CaretLeft size={14} />
                  </button>
                  <span className="px-2 text-xs text-muted-foreground">
                    {page} / {totalPages}
                  </span>
                  <button
                    title="Próxima página"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="p-1.5 rounded-lg border border-input text-muted-foreground hover:bg-muted transition-colors disabled:opacity-40"
                  >
                    <CaretRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: detail panel */}
        {selected && (
          <div className="w-80 shrink-0">
            <CertDetalhe cert={selected} onClose={() => setSelected(null)} />
          </div>
        )}
      </div>

      {/* Wizard modal */}
      {showWizard && (
        <WizardModal
          onClose={() => setShowWizard(false)}
          onSuccess={() => {
            loadCerts();
            setShowWizard(false);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stat Card                                                            */
/* ------------------------------------------------------------------ */

function StatCard({
  label,
  value,
  color,
  onClick,
  active,
}: {
  label: string;
  value: number;
  color: 'slate' | 'emerald' | 'amber' | 'red';
  onClick: () => void;
  active: boolean;
}) {
  const colorMap = {
    slate: { bg: 'bg-muted', border: 'border-input', text: 'text-foreground', num: 'text-foreground', activeBorder: 'border-slate-400' },
    emerald: { bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-600', num: 'text-emerald-700', activeBorder: 'border-emerald-400' },
    amber: { bg: 'bg-amber-50', border: 'border-amber-100', text: 'text-amber-600', num: 'text-amber-700', activeBorder: 'border-amber-400' },
    red: { bg: 'bg-red-50', border: 'border-red-100', text: 'text-red-600', num: 'text-red-700', activeBorder: 'border-red-400' },
  }[color];

  return (
    <button
      onClick={onClick}
      className={`rounded-lg border p-4 text-left transition-all cursor-pointer ${colorMap.bg} ${
        active ? `${colorMap.activeBorder} border-2` : `${colorMap.border} hover:border-opacity-70`
      }`}
    >
      <p className={`text-2xl font-bold ${colorMap.num}`}>{value}</p>
      <p className={`text-xs font-medium mt-0.5 ${colorMap.text}`}>{label}</p>
    </button>
  );
}
