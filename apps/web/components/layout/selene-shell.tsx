import React from 'react';
import { SeleneSidebar } from './sidebar';
import { SeleneTopbar } from './topbar';

export function SeleneShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <SeleneSidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <SeleneTopbar />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
