'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

/**
 * Estado global da empresa selecionada — dá continuidade ao CNPJ ao navegar
 * entre as telas (Visão Geral, DFe, Obrigações, Análise de Crédito, Faturamento…).
 *
 * O sistema tem dois "mundos" de identificador:
 *   • telas por CNPJ   → análise-crédito, visão-geral, demonstrações, indicadores-ecf, obrigações
 *   • telas por id UUID → faturamento, documentos-cancelados
 *
 * Por isso guardamos a identidade completa `{ id, cnpj, nome }`. Cada tela
 * pré-seleciona a empresa global pela chave que conhece (id ou cnpj) e grava
 * de volta o que conseguir ao trocar a seleção.
 */

const LS_KEY = 'selene:empresa-selecionada';

export interface EmpresaSelecionada {
  /** UUID da empresa — null quando a tela de origem só conhece o CNPJ. */
  id:   string | null;
  /** CNPJ apenas dígitos. */
  cnpj: string;
  /** Razão social / nome fantasia, para exibição. */
  nome: string | null;
}

export const onlyDigits = (s: string | null | undefined): string => (s ?? '').replace(/\D/g, '');

/** Compara dois CNPJs ignorando máscara e zeros à esquerda. */
export const mesmoCnpj = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const da = onlyDigits(a).padStart(14, '0');
  const db = onlyDigits(b).padStart(14, '0');
  return da === db && da !== '00000000000000';
};

interface EmpresaContextValue {
  empresa: EmpresaSelecionada | null;
  /** Define a empresa selecionada globalmente (persiste em localStorage). */
  selecionar: (e: EmpresaSelecionada | null) => void;
  /** Atalho para telas que conhecem apenas o CNPJ. */
  selecionarPorCnpj: (cnpj: string, nome?: string | null, id?: string | null) => void;
  limpar: () => void;
}

const EmpresaContext = createContext<EmpresaContextValue | null>(null);

function normalizar(e: EmpresaSelecionada | null): EmpresaSelecionada | null {
  if (!e || !e.cnpj) return null;
  return { id: e.id ?? null, cnpj: onlyDigits(e.cnpj), nome: e.nome ?? null };
}

function ler(): EmpresaSelecionada | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? normalizar(JSON.parse(raw) as EmpresaSelecionada) : null;
  } catch {
    return null;
  }
}

export function EmpresaSelecionadaProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [empresa, setEmpresa] = useState<EmpresaSelecionada | null>(ler);

  const selecionar = useCallback((e: EmpresaSelecionada | null) => {
    const norm = normalizar(e);
    setEmpresa(norm);
    try {
      if (norm) localStorage.setItem(LS_KEY, JSON.stringify(norm));
      else localStorage.removeItem(LS_KEY);
    } catch {
      /* localStorage indisponível — segue só em memória */
    }
  }, []);

  const selecionarPorCnpj = useCallback(
    (cnpj: string, nome: string | null = null, id: string | null = null) => {
      selecionar(cnpj ? { id, cnpj, nome } : null);
    },
    [selecionar],
  );

  const limpar = useCallback(() => selecionar(null), [selecionar]);

  return (
    <EmpresaContext.Provider value={{ empresa, selecionar, selecionarPorCnpj, limpar }}>
      {children}
    </EmpresaContext.Provider>
  );
}

export function useEmpresaSelecionada(): EmpresaContextValue {
  const ctx = useContext(EmpresaContext);
  if (!ctx) throw new Error('useEmpresaSelecionada deve ser usado dentro de <EmpresaSelecionadaProvider>');
  return ctx;
}
