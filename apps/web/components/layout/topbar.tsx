'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { CaretRightIcon, MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react';

// ── Mapa de rotas → breadcrumb ─────────────────────────────────────────────────
const ROUTE_MAP: Record<string, { label: string; section: string }> = {
  '/dfe/documentos':                          { label: 'NF-e',                        section: 'Documentos' },
  '/documentos-cancelados':                   { label: 'Documentos Fiscais Cancelados', section: 'Documentos' },
  '/obrigacoes-acessorias/efd-icms-ipi':      { label: 'EFD ICMS/IPI',                section: 'Obrigações Acessórias'  },
  '/obrigacoes-acessorias/ecd':               { label: 'ECD',                         section: 'Obrigações Acessórias'  },
  '/obrigacoes-acessorias/ecf':               { label: 'ECF',                         section: 'Obrigações Acessórias'  },
  '/obrigacoes-acessorias/efd-contribuicoes': { label: 'EFD Contribuições',            section: 'Obrigações Acessórias'  },
  '/analise-credito/demonstracoes':           { label: 'Demonstrações Financeiras',    section: 'Análise de Crédito'     },
  '/analise-credito/regras':                  { label: 'Regras de Crédito',           section: 'Análise de Crédito'     },
  '/analise-credito':                         { label: 'Dashboard',                   section: 'Análise de Crédito'     },
  '/dfe':          { label: 'DFe',                     section: 'Configurações' },
  '/certificados': { label: 'Certificados A1',          section: 'Configurações' },
  '/usuarios':     { label: 'Usuários',                section: 'Configurações' },
  '/empresas':     { label: 'Empresas',                section: 'Configurações' },
  '/etiquetas':    { label: 'Etiquetas',               section: 'Configurações' },
  '/auditoria':    { label: 'Auditoria',               section: 'Configurações' },
  '/perfis':       { label: 'Perfis',                  section: 'Configurações' },
  '/fornecedores': { label: 'Fornecedores',             section: 'Configurações' },
  '/unidades':     { label: 'Unidades Administrativas', section: 'Configurações' },
};

// ── Lista plana para pesquisa rápida ───────────────────────────────────────────
const ALL_NAV_ITEMS = [
  { href: '/dfe/documentos',                          label: 'NF-e',                     group: 'Documentos' },
  { href: '/documentos-cancelados',                   label: 'Documentos Fiscais Cancelados', group: 'Documentos' },
  { href: '/obrigacoes-acessorias/efd-icms-ipi',      label: 'EFD ICMS/IPI',             group: 'Obrigações Acessórias'  },
  { href: '/obrigacoes-acessorias/ecd',               label: 'ECD',                      group: 'Obrigações Acessórias'  },
  { href: '/obrigacoes-acessorias/ecf',               label: 'ECF',                      group: 'Obrigações Acessórias'  },
  { href: '/obrigacoes-acessorias/efd-contribuicoes', label: 'EFD Contribuições',        group: 'Obrigações Acessórias'  },
  { href: '/analise-credito',                         label: 'Dashboard',                group: 'Análise de Crédito'     },
  { href: '/analise-credito/demonstracoes',           label: 'Demonstrações Financeiras', group: 'Análise de Crédito'     },
  { href: '/analise-credito/regras',                  label: 'Regras de Crédito',         group: 'Análise de Crédito'     },
  { href: '/dfe',          label: 'DFe',                     group: 'Configurações' },
  { href: '/certificados', label: 'Certificados A1',          group: 'Configurações' },
  { href: '/usuarios',     label: 'Usuários',                group: 'Configurações' },
  { href: '/empresas',     label: 'Empresas',                group: 'Configurações' },
  { href: '/etiquetas',    label: 'Etiquetas',               group: 'Configurações' },
  { href: '/auditoria',    label: 'Auditoria',               group: 'Configurações' },
  { href: '/perfis',       label: 'Perfis',                  group: 'Configurações' },
  { href: '/fornecedores', label: 'Fornecedores',             group: 'Configurações' },
  { href: '/unidades',     label: 'Unidades Administrativas', group: 'Configurações' },
];

export function SeleneTopbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Resolve breadcrumb: tenta match exato, depois prefixo mais longo
  const crumb =
    ROUTE_MAP[pathname] ??
    Object.entries(ROUTE_MAP)
      .sort((a, b) => b[0].length - a[0].length)
      .find(([k]) => pathname.startsWith(k + '/'))?.[1];

  // Filtra itens conforme a query
  const filtered = query.trim()
    ? ALL_NAV_ITEMS.filter(
        (i) =>
          i.label.toLowerCase().includes(query.toLowerCase()) ||
          i.group.toLowerCase().includes(query.toLowerCase()),
      )
    : ALL_NAV_ITEMS;

  // Fecha ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Ctrl+K abre a pesquisa, Esc fecha
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleSelect = (href: string) => {
    setOpen(false);
    setQuery('');
    router.push(href);
  };

  const openSearch = () => {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <header className="h-14 shrink-0 border-b border-border bg-card flex items-center justify-between px-5 gap-4">

      {/* ── Breadcrumb ─────────────────────────────────────────── */}
      <nav className="flex items-center gap-1.5 min-w-0 flex-1" aria-label="Caminho atual">
        <Link
          href="/"
          className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          Início
        </Link>
        {crumb && (
          <>
            <CaretRightIcon size={11} className="text-muted-foreground/40 shrink-0" />
            <span className="text-sm text-muted-foreground shrink-0">{crumb.section}</span>
            <CaretRightIcon size={11} className="text-muted-foreground/40 shrink-0" />
            <span className="text-sm text-foreground font-medium truncate">{crumb.label}</span>
          </>
        )}
      </nav>

      {/* ── Pesquisa rápida ────────────────────────────────────── */}
      <div ref={containerRef} className="relative shrink-0">

        {/* Botão trigger (quando fechado) */}
        {!open && (
          <button
            type="button"
            onClick={openSearch}
            className="flex items-center gap-2 rounded-md border border-input bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MagnifyingGlassIcon size={12} />
            <span>Pesquisa rápida</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-border bg-background px-1 py-0.5 text-[9px] font-mono text-muted-foreground ml-1">
              Ctrl K
            </kbd>
          </button>
        )}

        {/* Painel de pesquisa (quando aberto) */}
        {open && (
          <div className="absolute right-0 top-0 z-50 w-80 shadow-xl rounded-lg overflow-hidden border border-input">
            {/* Input */}
            <div className="flex items-center gap-2 bg-card px-3 py-2 border-b border-input">
              <MagnifyingGlassIcon size={13} className="text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar página..."
                className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                aria-label="Fechar pesquisa"
                onClick={() => { setOpen(false); setQuery(''); }}
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <XIcon size={13} />
              </button>
            </div>

            {/* Resultados */}
            <div className="max-h-64 overflow-y-auto bg-card">
              {filtered.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">Nenhum resultado encontrado.</p>
              ) : (
                filtered.map((item) => (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => handleSelect(item.href)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-muted transition-colors border-b border-input/30 last:border-0"
                  >
                    <span className="text-sm text-foreground font-medium">{item.label}</span>
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">{item.group}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
