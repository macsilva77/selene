import { initTRPC, TRPCError } from '@trpc/server';

export interface Context {
  token?: string;
  userId?: string;
  tenantId?: string;
}

export function createContext(opts: { token?: string }): Context {
  return { token: opts.token };
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.token) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, token: ctx.token } });
});
