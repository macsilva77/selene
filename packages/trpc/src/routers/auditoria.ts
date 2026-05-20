import { z } from 'zod';
import { router, protectedProcedure } from '../context';

export const auditoriaRouter = router({
  list: protectedProcedure
    .input(z.object({ page: z.number().default(1), limit: z.number().default(20), modulo: z.string().optional() }).optional())
    .query(async () => ({ data: [], total: 0, page: 1, limit: 20 })),
});
