'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SignOut, User } from '@phosphor-icons/react';
import { getSessionUser, clearSession } from '@/lib/session';

export function SeleneHeader() {
  const router = useRouter();
  const [usuario, setUsuario] = useState<{ nome?: string } | null>(null);

  useEffect(() => {
    setUsuario(getSessionUser());
  }, []);

  function handleLogout() {
    clearSession();
    router.replace('/login');
  }

  return (
    <header className="flex h-16 items-center justify-between bg-primary px-6 shrink-0">
      <div />
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <User size={16} className="text-white/70" />
          <span className="text-white font-medium">{usuario?.nome ?? 'Usuário'}</span>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        >
          <SignOut size={16} />
          Sair
        </button>
      </div>
    </header>
  );
}
