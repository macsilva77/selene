'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowClockwise,
  CheckCircle,
  Clock,
  Copy,
  EnvelopeSimple,
  LinkSimple,
  Prohibit,
  Warning,
  X,
} from '@phosphor-icons/react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface Convite {
  id: string;
  email: string;
  apelido: string | null;
  status: 'PENDENTE' | 'USADO' | 'EXPIRADO' | 'REVOGADO';
  expiraEm: string;
  usadoEm: string | null;
  razaoSocial: string | null;
  cnpj: string | null;
  criadoPor: string | null;
  criadoEm: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatDateTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function maskCnpj(v: string | null | undefined) {
  const d = (v ?? '').replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function ConviteStatusBadge({ status }: { status: Convite['status'] }) {
  if (status === 'USADO') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
        <CheckCircle size={12} weight="fill" /> Concluído
      </span>
    );
  }
  if (status === 'PENDENTE') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
        <Clock size={12} weight="fill" /> Pendente
      </span>
    );
  }
  if (status === 'EXPIRADO') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
        <Warning size={12} weight="fill" /> Expirado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
      <Prohibit size={12} weight="fill" /> Revogado
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Gerar link — Modal                                                  */
/* ------------------------------------------------------------------ */

const VALIDADE_OPCOES = [
  { label: '24 horas', horas: 24 },
  { label: '72 horas (3 dias)', horas: 72 },
  { label: '7 dias', horas: 168 },
];

export function ConviteModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState('');
  const [apelido, setApelido] = useState('');
  const [validadeHoras, setValidadeHoras] = useState(72);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const { success } = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    if (!email) {
      setErro('Informe o e-mail do cliente.');
      return;
    }
    setEnviando(true);
    try {
      const res = await api.post('/certificados/convites', { email, apelido: apelido || undefined, validadeHoras });
      setLink(res.data?.link ?? null);
      success('Link gerado e e-mail enviado ao cliente.');
      onCreated();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      setErro(Array.isArray(msg) ? msg.join(' | ') : msg ?? 'Erro ao gerar o link.');
    } finally {
      setEnviando(false);
    }
  }

  async function copiarLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      success('Link copiado para a área de transferência.');
    } catch {
      setErro('Não foi possível copiar automaticamente. Copie o link manualmente.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={() => !enviando && onClose()} />
      <div className="relative z-10 w-full max-w-lg bg-card rounded-lg shadow-2xl overflow-hidden border border-border">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <LinkSimple size={18} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground leading-tight">Gerar link de onboarding</h2>
              <p className="text-xs text-muted-foreground mt-0.5">O cliente envia o próprio certificado com segurança</p>
            </div>
          </div>
          <button title="Fechar" onClick={() => !enviando && onClose()} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        {link ? (
          /* Sucesso — mostra link copiável */
          <div className="px-6 py-6 space-y-4">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-50 border border-emerald-100">
              <CheckCircle size={26} weight="fill" className="text-emerald-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-800">Link gerado com sucesso</p>
                <p className="text-xs text-emerald-700 mt-0.5">Enviamos por e-mail para <strong>{email}</strong>. Você também pode copiar e enviar por outro canal.</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                readOnly
                value={link}
                className="flex-1 px-3 py-2 rounded-lg border border-input bg-muted text-xs font-mono text-foreground focus:outline-none"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                onClick={copiarLink}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors shrink-0"
              >
                <Copy size={14} /> Copiar
              </button>
            </div>

            <div className="flex justify-end">
              <button onClick={onClose} className="px-4 py-2 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors">
                Concluir
              </button>
            </div>
          </div>
        ) : (
          /* Formulário */
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-foreground mb-1.5">
                E-mail do cliente <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <EnvelopeSimple size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="cliente@empresa.com.br"
                  autoFocus
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-input text-sm bg-muted focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-foreground mb-1.5">
                Apelido <span className="text-muted-foreground font-normal">(opcional)</span>
              </label>
              <input
                type="text"
                value={apelido}
                onChange={(e) => setApelido(e.target.value)}
                placeholder="Ex.: Padaria do João"
                className="w-full px-3 py-2.5 rounded-lg border border-input text-sm bg-muted focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary transition-all"
              />
              <p className="text-xs text-muted-foreground mt-1">Só para você localizar o convite na lista.</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-foreground mb-1.5">Validade do link</label>
              <select
                value={validadeHoras}
                onChange={(e) => setValidadeHoras(Number(e.target.value))}
                className="w-full px-3 py-2.5 rounded-lg border border-input text-sm bg-muted focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary transition-all"
              >
                {VALIDADE_OPCOES.map((o) => (
                  <option key={o.horas} value={o.horas}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-primary/[0.04] border border-primary/10">
              <CheckCircle size={16} weight="fill" className="text-primary shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground leading-relaxed">
                A empresa é <strong>criada automaticamente</strong> a partir dos dados do certificado enviado. A senha do certificado nunca é compartilhada com a equipe.
              </p>
            </div>

            {erro && (
              <p className="flex items-center gap-1.5 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                <Warning size={14} weight="fill" /> {erro}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} disabled={enviando} className="px-4 py-2.5 rounded-lg border border-input text-foreground text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50">
                Cancelar
              </button>
              <button type="submit" disabled={enviando} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60">
                {enviando ? <><ArrowClockwise size={15} className="animate-spin" /> Gerando…</> : <><EnvelopeSimple size={15} /> Gerar e enviar</>}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lista de convites                                                   */
/* ------------------------------------------------------------------ */

export function ConvitesView({ refreshKey }: { refreshKey: number }) {
  const [convites, setConvites] = useState<Convite[]>([]);
  const [loading, setLoading] = useState(true);
  const { success, error: toastError } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<Convite[]>('/certificados/convites');
      setConvites(Array.isArray(res.data) ? res.data : []);
    } catch {
      toastError('Erro ao carregar os convites.');
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function revogar(id: string) {
    try {
      await api.patch(`/certificados/convites/${id}/revogar`);
      success('Convite revogado.');
      setConvites((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'REVOGADO' } : c)));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toastError(msg ?? 'Erro ao revogar o convite.');
    }
  }

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden flex-1">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableHead>Cliente</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Empresa criada</TableHead>
            <TableHead>Validade / Conclusão</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <TableRow key={i} className="hover:bg-transparent">
                {[1, 2, 3, 4, 5].map((c) => (
                  <TableCell key={c}><div className="h-4 bg-muted rounded animate-pulse w-3/4" /></TableCell>
                ))}
              </TableRow>
            ))
          ) : convites.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="py-16 text-center text-muted-foreground">
                <div className="flex flex-col items-center gap-2">
                  <LinkSimple size={32} className="text-muted-foreground" />
                  <span className="text-sm">Nenhum convite gerado ainda. Clique em &quot;Gerar link&quot; para convidar um cliente.</span>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            convites.map((c) => (
              <TableRow key={c.id} className="hover:bg-muted/30">
                <TableCell>
                  <p className="font-medium text-foreground text-sm leading-tight">{c.apelido || c.email}</p>
                  {c.apelido && <p className="text-xs text-muted-foreground">{c.email}</p>}
                </TableCell>
                <TableCell><ConviteStatusBadge status={c.status} /></TableCell>
                <TableCell>
                  {c.status === 'USADO' ? (
                    <div>
                      <p className="text-sm text-foreground leading-tight">{c.razaoSocial ?? '—'}</p>
                      <p className="text-xs text-muted-foreground font-mono">{maskCnpj(c.cnpj)}</p>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {c.status === 'USADO' ? formatDateTime(c.usadoEm) : formatDateTime(c.expiraEm)}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {(c.status === 'PENDENTE') && (
                    <button
                      onClick={() => revogar(c.id)}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
                    >
                      Revogar
                    </button>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
