import { z } from 'zod';
import { router, protectedProcedure } from '../context';

export const perfisRouter = router({
  list: protectedProcedure.query(async () => [] as any[]),
  create: protectedProcedure
    .input(z.object({ nome: z.string(), descricao: z.string().optional(), permissoes: z.array(z.string()) }))
    .mutation(async () => null as any),
  update: protectedProcedure
    .input(z.object({ id: z.string(), nome: z.string().optional(), permissoes: z.array(z.string()).optional() }))
    .mutation(async () => null as any),
  remove: protectedProcedure.input(z.string()).mutation(async () => ({ success: true })),
});
