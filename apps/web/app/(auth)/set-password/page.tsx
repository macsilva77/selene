'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import axios from 'axios';
import { Eye, EyeSlash, CheckCircle, XCircle } from '@phosphor-icons/react';
import { api } from '@/lib/api';

const SENHA_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#+=\-_])[A-Za-z\d@$!%*?&#+=\-_]{10,}$/;

const criteria = [
  { label: 'Mínimo 10 caracteres',       test: (v: string) => v.length >= 10 },
  { label: 'Letra maiúscula',            test: (v: string) => /[A-Z]/.test(v) },
  { label: 'Letra minúscula',            test: (v: string) => /[a-z]/.test(v) },
  { label: 'Número',                     test: (v: string) => /\d/.test(v) },
  { label: 'Símbolo (@$!%*?&#+=-_)',     test: (v: string) => /[@$!%*?&#+=\-_]/.test(v) },
];

function SetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [showConfirmar, setShowConfirmar] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const senhaValida = SENHA_REGEX.test(senha);
  const confirmaBate = senha === confirmar && confirmar.length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('Token inválido ou ausente. Solicite um novo link.');
      return;
    }
    if (!senhaValida) {
      setError('A senha não atende aos critérios exigidos.');
      return;
    }
    if (!confirmaBate) {
      setError('As senhas não coincidem.');
      return;
    }

    setLoading(true);
    try {
      await api.post('/auth/set-password', { token, novaSenha: senha });
      setSuccess(true);
      setTimeout(() => router.replace('/login'), 3000);
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.message : undefined;
      const text = Array.isArray(msg) ? msg.join(' | ') : (msg ?? 'Erro ao definir senha.');
      if (text.toLowerCase().includes('expirado') || text.toLowerCase().includes('inválido')) {
        setError('Este link expirou ou já foi utilizado. Solicite um novo link de acesso.');
      } else {
        setError(text);
      }
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-xl border bg-card text-card-foreground shadow-lg p-8 text-center">
        <CheckCircle size={48} weight="fill" className="mx-auto mb-4 text-green-500" />
        <h2 className="text-xl font-semibold mb-2">Senha definida com sucesso!</h2>
        <p className="text-sm text-muted-foreground">Você será redirecionado para o login em instantes…</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-lg p-8">
      <h2 className="text-xl font-semibold mb-1">Criar senha de acesso</h2>
      <p className="text-sm text-muted-foreground mb-6">Defina sua senha para acessar o sistema.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="senha">Nova senha</label>
          <div className="relative">
            <input
              id="senha"
              type={showSenha ? 'text' : 'password'}
              autoComplete="new-password"
              required
              value={senha}
              onChange={e => setSenha(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder="••••••••••"
            />
            <button
              type="button"
              onClick={() => setShowSenha(v => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showSenha ? <EyeSlash size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {senha.length > 0 && (
          <ul className="space-y-1 text-xs">
            {criteria.map(c => {
              const ok = c.test(senha);
              return (
                <li key={c.label} className={`flex items-center gap-1.5 ${ok ? 'text-green-600' : 'text-muted-foreground'}`}>
                  {ok
                    ? <CheckCircle size={12} weight="fill" className="shrink-0" />
                    : <XCircle size={12} weight="fill" className="shrink-0" />
                  }
                  {c.label}
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="confirmar">Confirmar senha</label>
          <div className="relative">
            <input
              id="confirmar"
              type={showConfirmar ? 'text' : 'password'}
              autoComplete="new-password"
              required
              value={confirmar}
              onChange={e => setConfirmar(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder="••••••••••"
            />
            <button
              type="button"
              onClick={() => setShowConfirmar(v => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showConfirmar ? <EyeSlash size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {confirmar.length > 0 && !confirmaBate && (
            <p className="text-xs text-destructive">As senhas não coincidem.</p>
          )}
        </div>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || !senhaValida || !confirmaBate}
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Salvando…' : 'Definir senha'}
        </button>
      </form>
    </div>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<div className="rounded-xl border bg-card shadow-lg p-8 text-sm text-muted-foreground">Carregando…</div>}>
      <SetPasswordForm />
    </Suspense>
  );
}
