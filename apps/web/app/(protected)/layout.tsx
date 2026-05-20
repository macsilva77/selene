import { SeleneShell } from '@/components/layout/selene-shell';
import { AuthGuard } from '@/components/layout/auth-guard';

export default function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <SeleneShell>
      <AuthGuard>{children}</AuthGuard>
    </SeleneShell>
  );
}
