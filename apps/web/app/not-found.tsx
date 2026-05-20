import Link from 'next/link';
import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';

export default function NotFound() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 text-center">
      <MagnifyingGlass size={48} className="text-muted-foreground" />
      <div>
        <h2 className="text-2xl font-bold">404</h2>
        <p className="text-muted-foreground mt-1">Página não encontrada.</p>
      </div>
      <Link
        href="/dashboard"
        className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Voltar ao início
      </Link>
    </div>
  );
}
