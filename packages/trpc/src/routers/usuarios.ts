import { z } from 'zod';
import { router, protectedProcedure } from '../context';

export const usuariosRouter = router({
  list: protectedProcedure
    .input(z.object({ page: z.number().default(1), limit: z.number().default(20) }).optional())
    .query(async () => ({ data: [], total: 0, page: 1, limit: 20 })),
  create: protectedProcedure
    .input(z.object({ nome: z.string(), email: z.string().email(), role: z.string(), senha: z.string() }))
    .mutation(async () => null as any),
  update: protectedProcedure
    .input(z.object({ id: z.string(), nome: z.string().optional(), email: z.string().optional() }))
    .mutation(async () => null as any),
  remove: protectedProcedure.input(z.string()).mutation(async () => ({ success: true })),
});
