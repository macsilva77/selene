import { z } from 'zod';
import { router, protectedProcedure } from '../context';

export const empresasRouter = router({
  list: protectedProcedure.query(async () => [] as any[]),
  create: protectedProcedure
    .input(z.object({ nome: z.string(), cnpj: z.string(), email: z.string().optional() }))
    .mutation(async () => null as any),
  update: protectedProcedure
    .input(z.object({ id: z.string(), nome: z.string().optional() }))
    .mutation(async () => null as any),
});
