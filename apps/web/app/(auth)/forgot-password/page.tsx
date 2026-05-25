'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { CheckCircle } from '@phosphor-icons/react';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.message : undefined;
      setError(Array.isArray(msg) ? msg.join(' | ') : (msg ?? 'Erro ao enviar e-mail.'));
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-xl border bg-card text-card-foreground shadow-lg p-8 text-center">
        <CheckCircle size={48} weight="fill" className="mx-auto mb-4 text-green-500" />
        <h2 className="text-xl font-semibold mb-2">Verifique seu e-mail</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Se o endereço <strong>{email}</strong> estiver cadastrado, você receberá um link de redefinição em breve.
        </p>
        <Link href="/login" className="text-sm text-primary hover:underline">
          Voltar ao login
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-lg p-8">
      <h2 className="text-xl font-semibold mb-1">Esqueci minha senha</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Informe seu e-mail e enviaremos um link para redefinição.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="email">E-mail</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            placeholder="seu@email.com"
          />
        </div>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Enviando…' : 'Enviar link'}
        </button>

        <div className="text-center">
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
            Voltar ao login
          </Link>
        </div>
      </form>
    </div>
  );
}
