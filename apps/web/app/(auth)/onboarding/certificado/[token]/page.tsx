'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import axios from 'axios';
import {
  ArrowClockwise,
  CheckCircle,
  Eye,
  EyeSlash,
  FileArrowUp,
  FilePdf,
  ShieldCheck,
  UploadSimple,
  Warning,
  X,
} from '@phosphor-icons/react';
import { api } from '@/lib/api';

type Estado = 'carregando' | 'valido' | 'invalido' | 'concluido';

function maskCnpj(v: string | null | undefined) {
  const d = (v ?? '').replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

function extractMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const msg = err.response?.data?.message;
    if (Array.isArray(msg)) return msg.join(' | ');
    if (typeof msg === 'string') return msg;
  }
  return fallback;
}

export default function OnboardingCertificadoPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';

  const [estado, setEstado] = useState<Estado>('carregando');
  const [apelido, setApelido] = useState<string | null>(null);
  const [erroToken, setErroToken] = useState('');

  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [resultado, setResultado] = useState<{ razaoSocial: string; cnpj: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validarToken = useCallback(async () => {
    if (!token) {
      setEstado('invalido');
      setErroToken('Link inválido.');
      return;
    }
    try {
      const res = await api.get(`/onboarding/certificado/${token}`);
      setApelido(res.data?.apelido ?? null);
      setEstado('valido');
    } catch (err: unknown) {
      setErroToken(extractMessage(err, 'Este link é inválido ou expirou.'));
      setEstado('invalido');
    }
  }, [token]);

  useEffect(() => {
    validarToken();
  }, [validarToken]);

  function selecionarArquivo(f: File | null | undefined) {
    if (!f) return;
    if (f.name.endsWith('.pfx') || f.name.endsWith('.p12')) {
      setFile(f);
      setErro('');
    } else {
      setErro('Apenas arquivos .pfx ou .p12 são aceitos.');
    }
  }

  async function handleEnviar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    if (!file) {
      setErro('Selecione o arquivo do certificado (.pfx ou .p12).');
      return;
    }
    if (!password) {
      setErro('Informe a senha do certificado.');
      return;
    }
    setEnviando(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('password', password);
      const res = await api.post(`/onboarding/certificado/${token}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResultado({ razaoSocial: res.data?.razaoSocial ?? '', cnpj: res.data?.cnpj ?? '' });
      setEstado('concluido');
    } catch (err: unknown) {
      setErro(extractMessage(err, 'Não foi possível enviar o certificado. Tente novamente.'));
    } finally {
      setEnviando(false);
    }
  }

  /* ----- Estados de tela ----- */

  if (estado === 'carregando') {
    return (
      <div className="rounded-xl border bg-card text-card-foreground shadow-lg p-8 text-center">
        <ArrowClockwise size={28} className="mx-auto mb-3 text-muted-foreground animate-spin" />
        <p className="text-sm text-muted-foreground">Validando o link…</p>
      </div>
    );
  }

  if (estado === 'invalido') {
    return (
      <div className="rounded-xl border bg-card text-card-foreground shadow-lg p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
          <X size={26} weight="bold" className="text-red-600" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Link indisponível</h2>
        <p className="text-sm text-muted-foreground">{erroToken}</p>
        <p className="text-xs text-muted-foreground mt-4">Entre em contato com a equipe responsável para receber um novo link.</p>
      </div>
    );
  }

  if (estado === 'concluido') {
    return (
      <div className="rounded-xl border bg-card text-card-foreground shadow-lg p-8 text-center">
        <CheckCircle size={48} weight="fill" className="mx-auto mb-4 text-emerald-500" />
        <h2 className="text-xl font-semibold mb-2">Certificado recebido!</h2>
        <p className="text-sm text-muted-foreground">
          O certificado de <strong>{resultado?.razaoSocial || 'sua empresa'}</strong>
          {resultado?.cnpj ? <> (<span className="font-mono">{maskCnpj(resultado.cnpj)}</span>)</> : null} foi enviado com segurança.
        </p>
        <p className="text-sm text-muted-foreground mt-2">Você já pode fechar esta página. Obrigado!</p>
      </div>
    );
  }

  /* ----- Formulário ----- */

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-lg p-8">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <ShieldCheck size={20} className="text-primary" />
        </div>
        <h2 className="text-xl font-semibold">Envio de Certificado A1</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        {apelido ? `Olá, ${apelido}! ` : ''}Envie seu certificado digital com segurança. Sua senha não é compartilhada com a equipe.
      </p>

      <form onSubmit={handleEnviar} className="space-y-4">
        {/* Dropzone */}
        {file ? (
          <div className="flex items-center gap-4 p-4 rounded-lg bg-emerald-50 border border-emerald-200">
            <div className="w-11 h-11 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
              <FilePdf size={24} weight="fill" className="text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-emerald-800 truncate">{file.name}</p>
              <p className="text-xs text-emerald-600 mt-0.5">{(file.size / 1024).toFixed(1)} KB</p>
            </div>
            <button
              type="button"
              onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
              className="shrink-0 p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-100 transition-colors"
              title="Remover arquivo"
            >
              <X size={15} />
            </button>
          </div>
        ) : (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); selecionarArquivo(e.dataTransfer.files[0]); }}
            onClick={() => fileInputRef.current?.click()}
            className="group border-2 border-dashed border-input rounded-lg p-8 text-center cursor-pointer hover:border-primary/60 hover:bg-primary/[0.02] transition-all"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pfx,.p12"
              title="Selecionar certificado"
              className="hidden"
              onChange={(e) => selecionarArquivo(e.target.files?.[0])}
            />
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 rounded-lg bg-muted group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                <FileArrowUp size={26} className="text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <p className="text-sm font-semibold text-muted-foreground group-hover:text-primary transition-colors">Arraste o certificado aqui</p>
              <p className="text-xs text-muted-foreground">ou clique para selecionar · .pfx ou .p12</p>
            </div>
          </div>
        )}

        {/* Senha */}
        <div>
          <label className="block text-sm font-semibold text-foreground mb-1.5">
            Senha do certificado <span className="text-red-400">*</span>
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Digite a senha"
              className="w-full px-3 py-2.5 pr-11 rounded-lg border border-input text-sm bg-muted focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary transition-all"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              tabIndex={-1}
            >
              {showPassword ? <EyeSlash size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </div>

        {erro && (
          <p className="flex items-center gap-1.5 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            <Warning size={14} weight="fill" /> {erro}
          </p>
        )}

        <button
          type="submit"
          disabled={enviando}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {enviando ? <><ArrowClockwise size={16} className="animate-spin" /> Enviando…</> : <><UploadSimple size={16} /> Enviar certificado</>}
        </button>

        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck size={13} /> Armazenamento criptografado AES-256
        </p>
      </form>
    </div>
  );
}
