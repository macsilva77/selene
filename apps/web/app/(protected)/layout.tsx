import { SeleneShell } from '@/components/layout/selene-shell';
import { AuthGuard } from '@/components/layout/auth-guard';
import { EmpresaSelecionadaProvider } from '@/lib/empresa-selecionada';

export default function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <EmpresaSelecionadaProvider>
      <SeleneShell>
        <AuthGuard>{children}</AuthGuard>
      </SeleneShell>
    </EmpresaSelecionadaProvider>
  );
}
