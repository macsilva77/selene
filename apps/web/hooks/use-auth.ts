'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Usuario {
  id: string;
  nome: string;
  email: string;
  role: string;
  tenantId: string;
}

interface AuthState {
  token: string | null;
  usuario: Usuario | null;
  isLoaded: boolean;
}

export function useAuth() {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({ token: null, usuario: null, isLoaded: false });

  useEffect(() => {
    const token = localStorage.getItem('selene_token');
    const raw = localStorage.getItem('selene_usuario');
    setState({
      token,
      usuario: raw ? JSON.parse(raw) : null,
      isLoaded: true,
    });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('selene_token');
    localStorage.removeItem('selene_usuario');
    router.replace('/login');
  }, [router]);

  return { ...state, logout };
}
