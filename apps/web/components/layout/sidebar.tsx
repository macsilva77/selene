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
  CaretDownIcon,
  ChartLineIcon,
  ChartBarIcon,
  FilesIcon,
  SlidersIcon,
  UsersThreeIcon,
  ArrowsClockwiseIcon,
  StorefrontIcon,
  ProhibitIcon,
  FlowArrowIcon,
  GaugeIcon,
} from '@phosphor-icons/react';
import { getSessionUser, clearSession } from '@/lib/session';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NavItem = { href?: string; icon: React.ComponentType<any>; label: string; soon?: boolean; children?: NavItem[] };
type NavSection = { id: string; label: string; items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  {
    id: 'configuracoes',
    label: 'Configurações',
    items: [
      { href: '/auditoria',    icon: ClipboardTextIcon,   label: 'Auditoria' },
      { href: '/certificados', icon: CertificateIcon,     label: 'Certificados A1' },
      { href: '/dfe',          icon: CloudArrowDownIcon,  label: 'DFe' },
      { href: '/empresas',     icon: BuildingsIcon,       label: 'Empresas' },
      { href: '/etiquetas',    icon: TagIcon,             label: 'Etiquetas' },
      { href: '/fornecedores', icon: TruckIcon,           label: 'Fornecedores' },
      { href: '/perfis',       icon: UserCircleGearIcon,  label: 'Perfis' },
      { href: '/tenants',      icon: StorefrontIcon,      label: 'Tenants' },
      { href: '/unidades',     icon: FingerprintIcon,     label: 'Unid. Administrativas' },
      { href: '/usuarios',     icon: UsersIcon,           label: 'Usuários' },
    ],
  },
  {
    id: 'documentos',
    label: 'Documentos',
    items: [
      { href: '/dfe/documentos',        icon: FileMagnifyingGlassIcon, label: 'NF-e' },
      { href: '/nfse',                  icon: ReceiptIcon,             label: 'NFS-e' },
      { href: '#',                      icon: TruckIcon,               label: 'CT-e',  soon: true },
      { href: '/documentos-cancelados', icon: ProhibitIcon,            label: 'Documentos Fiscais Cancelados' },
      {
        icon: FilesIcon,
        label: 'Obrigações Acessórias',
        children: [
          { href: '/obrigacoes-acessorias/ecd',               icon: ReceiptIcon, label: 'ECD' },
          { href: '/obrigacoes-acessorias/ecf',               icon: ReceiptIcon, label: 'ECF' },
          { href: '/obrigacoes-acessorias/efd-icms-ipi',      icon: ReceiptIcon, label: 'EFD ICMS/IPI' },
          { href: '/obrigacoes-acessorias/efd-contribuicoes', icon: ReceiptIcon, label: 'EFD Contribuições' },
        ],
      },
    ],
  },
  {
    id: 'analise-credito',
    label: 'Análise de Crédito',
    items: [
      { href: '/visao-geral',                    icon: GaugeIcon,     label: 'Visão Geral' },
      { href: '/analise-credito',                icon: ChartLineIcon, label: 'Dashboard' },
      { href: '/analise-credito/demonstracoes',  icon: FilesIcon,     label: 'Demonstrações Financeiras' },
      { href: '/analise-credito/regras',         icon: SlidersIcon,   label: 'Regras de Crédito' },
      { href: '/indicadores-ecf',                icon: ChartBarIcon,  label: 'Indicadores Fiscais ECF' },
    ],
  },
  {
    id: 'fiscal-analytics',
    label: 'Análise Fiscal',
    items: [
      { href: '/cadeia-suprimento',                   icon: FlowArrowIcon,       label: 'Cadeia de Suprimento' },
      { href: '/faturamento',                         icon: ChartBarIcon,        label: 'Faturamento' },
      { href: '/clientes-fornecedores',               icon: UsersThreeIcon,      label: 'Clientes e Fornecedores' },
      { href: '/clientes-fornecedores/processamento', icon: ArrowsClockwiseIcon, label: 'Processamento CF' },
    ],
  },
];

export function SeleneSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [usuario, setUsuario] = useState<{ nome?: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [subCollapsed, setSubCollapsed] = useState<Record<string, boolean>>({});

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

  // /dfe must be exact to avoid matching /dfe/documentos (which has its own item)
  const isActive = (href: string) => {
    if (pathname === href) return true;
    if (href === '/dfe') return false;
    return pathname.startsWith(href + '/');
  };

  const toggleSection = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  const toggleSub = (id: string) =>
    setSubCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  // Ativo considerando filhos (submenu)
  const itemActive = (item: NavItem): boolean =>
    (item.href ? isActive(item.href) : false) || (item.children?.some(itemActive) ?? false);

  const renderNavItem = (item: NavItem, nested = false): React.ReactNode => {
    const { href, icon: Icon, label, soon, children } = item;
    const indent = nested ? '' : 'ml-1';

    // Submenu (grupo aninhado, expansível)
    if (children && children.length > 0) {
      const open = !subCollapsed[label];
      const active = children.some(itemActive);
      return (
        <div key={label}>
          <button
            type="button"
            onClick={() => toggleSub(label)}
            className={[
              'w-full flex items-center gap-2.5 rounded-md px-3 py-[7px] text-sm font-medium transition-colors ml-1',
              active
                ? 'text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/55 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
            ].join(' ')}
          >
            <Icon size={15} weight={active ? 'fill' : 'regular'} />
            <span className="truncate">{label}</span>
            <CaretDownIcon
              size={10}
              className={`ml-auto shrink-0 transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
            />
          </button>
          {open && (
            <div className="mt-0.5 space-y-0.5 ml-4 border-l border-sidebar-border/60 pl-1">
              {children.map((c) => renderNavItem(c, true))}
            </div>
          )}
        </div>
      );
    }

    // Item em construção (desativado, com selo)
    if (soon) {
      return (
        <div
          key={label}
          title="Em construção"
          aria-disabled="true"
          className={`flex items-center gap-2.5 rounded-md px-3 py-[7px] text-sm font-medium ${indent} text-sidebar-foreground/35 cursor-not-allowed select-none`}
        >
          <Icon size={15} weight="regular" />
          <span className="truncate">{label}</span>
          <span className="ml-auto shrink-0 rounded-sm bg-sidebar-foreground/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sidebar-foreground/45">
            Construção
          </span>
        </div>
      );
    }

    // Item normal (link)
    const active = href ? isActive(href) : false;
    return (
      <Link
        key={href}
        href={href ?? '#'}
        className={[
          `flex items-center gap-2.5 rounded-md px-3 py-[7px] text-sm font-medium transition-colors ${indent}`,
          active
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground/55 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
        ].join(' ')}
      >
        <Icon size={15} weight={active ? 'fill' : 'regular'} />
        <span className="truncate">{label}</span>
      </Link>
    );
  };

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col bg-sidebar border-r border-sidebar-border text-sidebar-foreground">

      {/* Logo / Brand */}
      <div className="flex h-14 items-center px-4 border-b border-sidebar-border shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-positivo.png" alt="EOS" className="h-8 w-auto object-contain" />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {NAV_SECTIONS.map((section) => {
          const isOpen = !collapsed[section.id];
          const hasActive = section.items.some(itemActive);
          return (
            <div key={section.id} className="mb-2">
              {/* Section header — clicável para colapsar */}
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                className={[
                  'w-full flex items-center justify-between px-3 py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-colors',
                  hasActive && !isOpen
                    ? 'text-primary'
                    : 'text-sidebar-foreground/40 hover:text-sidebar-foreground/70',
                ].join(' ')}
              >
                <span>{section.label}</span>
                <CaretDownIcon
                  size={10}
                  className={`shrink-0 transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`}
                />
              </button>

              {/* Items */}
              {isOpen && (
                <div className="mt-0.5 space-y-0.5">
                  {section.items.map((item) => renderNavItem(item))}
                </div>
              )}
            </div>
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
