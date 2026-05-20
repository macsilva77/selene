import { router } from './context';
import { authRouter } from './routers/auth';
import { usuariosRouter } from './routers/usuarios';
import { empresasRouter } from './routers/empresas';
import { fornecedoresRouter } from './routers/fornecedores';
import { certificadosRouter } from './routers/certificados';
import { perfisRouter } from './routers/perfis';
import { auditoriaRouter } from './routers/auditoria';

export const appRouter = router({
  auth: authRouter,
  usuarios: usuariosRouter,
  empresas: empresasRouter,
  fornecedores: fornecedoresRouter,
  certificados: certificadosRouter,
  perfis: perfisRouter,
  auditoria: auditoriaRouter,
});

export type AppRouter = typeof appRouter;
