import { tokenStore } from '@selene/providers';

export interface SessionUser {
  id: string;
  nome: string;
  email: string;
  role: string;
  tenantId: string;
  permissoes?: string[];
  tenant?: { slug: string; plano: string };
}

export function getSessionUser(): SessionUser | null {
  if (globalThis.window === undefined) return null;
  try {
    const raw = localStorage.getItem('selene_usuario');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as SessionUser;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  tokenStore.set(null);
  localStorage.removeItem('selene_usuario');
  // Os cookies HttpOnly (selene_token, refresh_token) são limpos pelo servidor no POST /auth/logout
}
