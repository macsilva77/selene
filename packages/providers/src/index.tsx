'use client';

import React, {
  createContext, useContext, useState, useCallback, useEffect, useRef, useMemo,
} from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCReact, type CreateTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@selene/trpc';
import { tokenStore } from './token-store';

export { tokenStore } from './token-store';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3100';

const _trpc: CreateTRPCReact<AppRouter, unknown> = createTRPCReact<AppRouter>();
export const TRPCProvider: CreateTRPCReact<AppRouter, unknown>['Provider'] = _trpc.Provider;
export const useTRPC: CreateTRPCReact<AppRouter, unknown>['useUtils'] = _trpc.useUtils;

export interface SessionUser {
  id: string;
  nome: string;
  email: string;
  role: string;
  tenantId: string;
  permissoes?: string[];
  tenant?: { slug: string; plano: string };
}

interface AuthState {
  token: string | null;
  usuario: SessionUser | null;
}

interface AuthContextValue {
  auth: AuthState;
  isInitialized: boolean;
  setAuth: (next: AuthState) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  auth: { token: null, usuario: null },
  isInitialized: false,
  setAuth: () => {},
  logout: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

async function silentRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { accessToken?: string };
    return data.accessToken ?? null;
  } catch {
    return null;
  }
}

export function SeleneProviders({ children }: Readonly<{ children: React.ReactNode }>) {
  const [auth, setAuth] = useState<AuthState>(() => {
    if (globalThis.window === undefined) return { token: null, usuario: null };
    // Restaura só o usuario (não sensível) — token vem via silent refresh (cookie HttpOnly)
    try {
      const raw = localStorage.getItem('selene_usuario');
      return { token: null, usuario: raw ? (JSON.parse(raw) as SessionUser) : null };
    } catch {
      return { token: null, usuario: null };
    }
  });

  const [isInitialized, setIsInitialized] = useState(false);
  const refreshedRef = useRef(false);

  // Silent refresh: restaura o access token usando o cookie HttpOnly de refresh
  useEffect(() => {
    if (refreshedRef.current) return;
    refreshedRef.current = true;

    silentRefresh().then((accessToken) => {
      if (accessToken) {
        tokenStore.set(accessToken);
        setAuth((prev: AuthState) => ({ ...prev, token: accessToken }));
      } else {
        // Refresh falhou (não há sessão ativa) — limpa usuario obsoleto
        localStorage.removeItem('selene_usuario');
        setAuth({ token: null, usuario: null });
      }
      setIsInitialized(true);
    });
  }, []);

  const updateAuth = useCallback((next: AuthState) => {
    tokenStore.set(next.token);
    setAuth(next);
    if (next.usuario) {
      localStorage.setItem('selene_usuario', JSON.stringify(next.usuario));
    } else {
      localStorage.removeItem('selene_usuario');
    }
  }, []);

  const logout = useCallback(() => updateAuth({ token: null, usuario: null }), [updateAuth]);

  const [queryClient] = useState(() => new QueryClient());

  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: `${API_BASE}/trpc`,
          headers() {
            const t = tokenStore.get();
            return t ? { Authorization: `Bearer ${t}` } : {};
          },
        }),
      ],
    }),
  );

  const contextValue = useMemo<AuthContextValue>(
    () => ({ auth, isInitialized, setAuth: updateAuth, logout }),
    [auth, isInitialized, updateAuth, logout],
  );

  return (
    <AuthContext.Provider value={contextValue}>
      <TRPCProvider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </TRPCProvider>
    </AuthContext.Provider>
  );
}
