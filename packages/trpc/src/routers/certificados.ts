import { z } from 'zod';
import { router, protectedProcedure } from '../context';

export const certificadosRouter = router({
  list: protectedProcedure
    .input(z.object({ page: z.number().default(1), limit: z.number().default(20) }).optional())
    .query(async () => ({ data: [], total: 0 })),
  upload: protectedProcedure
    .input(z.object({ empresaId: z.string(), senha: z.string() }))
    .mutation(async () => null as any),
  remove: protectedProcedure.input(z.string()).mutation(async () => ({ success: true })),
});
