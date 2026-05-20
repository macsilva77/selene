import React from 'react';
import { SeleneSidebar } from './sidebar';

export function SeleneShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <SeleneSidebar />
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
