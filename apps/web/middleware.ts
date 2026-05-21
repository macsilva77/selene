import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(_request: NextRequest) {
  // Auth verificada client-side via AuthGuard (@selene/providers).
  // O cookie selene_token é setado pelo domínio da API (cross-origin) e não
  // fica acessível ao middleware do Next.js neste domínio. A proteção de rotas
  // é feita no componente AuthGuard que aguarda o silentRefresh antes de redirecionar.
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
