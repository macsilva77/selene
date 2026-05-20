import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from '../context';

export const authRouter = router({
  login: publicProcedure
    .input(z.object({ email: z.string().email(), senha: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return { token: '', usuario: null as any };
    }),
  me: protectedProcedure.query(async ({ ctx }) => {
    return null as any;
  }),
  logout: protectedProcedure.mutation(async () => {
    return { success: true };
  }),
});
