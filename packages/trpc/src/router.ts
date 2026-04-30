// Root tRPC router. Domain routers attach here as they land.
import { router, authedProcedure, publicProcedure } from "./server";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true, ts: new Date().toISOString() })),
  me: authedProcedure.query(({ ctx }) => ({
    userId: ctx.user.userId,
    workspaceId: ctx.user.workspaceId,
    accessRole: ctx.user.accessRole,
    salesRoleSlugs: ctx.user.salesRoleSlugs,
  })),
});

export type AppRouter = typeof appRouter;
