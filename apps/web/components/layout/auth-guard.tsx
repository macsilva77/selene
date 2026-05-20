'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@selene/providers';

export function AuthGuard({ children }: Readonly<{ children: React.ReactNode }>) {
  const { auth, isInitialized } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isInitialized && !auth.token) {
      router.replace('/login');
    }
  }, [isInitialized, auth.token, router]);

  if (!isInitialized) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!auth.token) return null;

  return <>{children}</>;
}
