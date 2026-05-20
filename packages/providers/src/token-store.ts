// Token de acesso em memória — nunca persiste em localStorage/cookie acessível por JS.
// Perdido ao recarregar a página: o AuthProvider restaura via silent refresh (cookie HttpOnly).
let _token: string | null = null;

export const tokenStore = {
  get: (): string | null => _token,
  set: (token: string | null): void => { _token = token; },
};
