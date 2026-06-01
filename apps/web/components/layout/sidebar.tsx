'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BuildingsIcon,
  UsersIcon,
  UserCircleGearIcon,
  ClipboardTextIcon,
  TruckIcon,
  FingerprintIcon,
  CertificateIcon,
  CloudArrowDownIcon,
  FileMagnifyingGlassIcon,
  SignOutIcon,
  TagIcon,
  ReceiptIcon,
} from '@phosphor-icons/react';
import { getSessionUser, clearSession } from '@/lib/session';

const NAV_ITEMS = [
  { href: '/empresas', icon: BuildingsIcon, label: 'Empresas' },
  { href: '/usuarios', icon: UsersIcon, label: 'Usuários' },
  { href: '/perfis', icon: UserCircleGearIcon, label: 'Perfis' },
  { href: '/fornecedores', icon: TruckIcon, label: 'Fornecedores' },
  { href: '/certificados', icon: CertificateIcon, label: 'Certificados A1' },
] as const;

const CONFIG_ITEMS = [
  { href: '/dfe', icon: CloudArrowDownIcon, label: 'DFe / NF-e' },
  { href: '/dfe/documentos', icon: FileMagnifyingGlassIcon, label: 'Documentos Fiscais' },
  { href: '/etiquetas', icon: TagIcon, label: 'Etiquetas' },
  { href: '/unidades', icon: FingerprintIcon, label: 'Unidades' },
  { href: '/auditoria', icon: ClipboardTextIcon, label: 'Auditoria' },
] as const;

const OBRIGACOES_ITEMS = [
  { href: '/obrigacoes-acessorias/efd-icms-ipi',    icon: ReceiptIcon, label: 'EFD ICMS/IPI' },
  { href: '/obrigacoes-acessorias/efd-contribuicoes', icon: ReceiptIcon, label: 'EFD Contribuições' },
  { href: '/obrigacoes-acessorias/ecd',             icon: ReceiptIcon, label: 'ECD' },
  { href: '/obrigacoes-acessorias/ecf',             icon: ReceiptIcon, label: 'ECF' },
] as const;

export function SeleneSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [usuario, setUsuario] = useState<{ nome?: string } | null>(null);

  useEffect(() => {
    setUsuario(getSessionUser());
  }, []);

  function handleLogout() {
    clearSession();
    router.replace('/login');
  }

  const initials = usuario?.nome
    ? usuario.nome.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase()
    : 'U';

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col bg-sidebar border-r border-sidebar-border text-sidebar-foreground">

      {/* Logo / Brand */}
      <div className="flex h-16 items-center px-4 border-b border-sidebar-border shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-positivo.png" alt="EOS" className="h-9 w-auto object-contain" />
      </div>

      {/* Nav principal */}
      <nav className="flex-1 overflow-y-auto py-2 px-3 space-y-0.5">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={[
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/45 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              ].join(' ')}
            >
              <Icon size={18} weight={active ? 'fill' : 'regular'} />
              {label}
            </Link>
          );
        })}

        {/* Seção Configurações */}
        <div className="pt-4 pb-1 px-3">
          <p className="text-xs text-sidebar-foreground/40 font-medium">
            Configurações
          </p>
        </div>
        {CONFIG_ITEMS.map(({ href, icon: Icon, label }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={[
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/45 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              ].join(' ')}
            >
              <Icon size={18} weight={active ? 'fill' : 'regular'} />
              {label}
            </Link>
          );
        })}

        {/* Seção Obrigações Acessórias */}
        <div className="pt-4 pb-1 px-3">
          <p className="text-xs text-sidebar-foreground/40 font-medium">
            Obrigações Acessórias
          </p>
        </div>
        {OBRIGACOES_ITEMS.map(({ href, icon: Icon, label }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              className={[
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/45 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              ].join(' ')}
            >
              <Icon size={18} weight={active ? 'fill' : 'regular'} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User info */}
      <div className="shrink-0 border-t border-sidebar-border p-3">
        <button
          type="button"
          onClick={handleLogout}
          title="Sair da conta"
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-sidebar-accent transition-colors"
        >
          <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center shrink-0 text-xs font-bold text-white">
            {initials}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm font-medium text-sidebar-foreground truncate leading-none">{usuario?.nome ?? 'Usuário'}</p>
            <p className="text-[11px] text-sidebar-foreground/50 mt-0.5">Backoffice</p>
          </div>
          <SignOutIcon size={14} className="text-sidebar-foreground/40 shrink-0" />
        </button>
      </div>
    </aside>
  );
}
