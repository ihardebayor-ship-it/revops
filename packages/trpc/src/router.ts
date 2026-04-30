// Root tRPC router. Domain routers attach here as they land.
import { router, authedProcedure, publicProcedure } from "./server";
import { buildAgentRouter } from "./agent-router";
import { tasksRouter } from "./routers/tasks";
import { onboardingRouter } from "./routers/onboarding";
import { rolesRouter } from "./routers/roles";
import { funnelRouter } from "./routers/funnel";
import { dispositionsRouter } from "./routers/dispositions";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true, ts: new Date().toISOString() })),
  me: authedProcedure.query(({ ctx }) => ({
    userId: ctx.user.userId,
    workspaceId: ctx.user.workspaceId,
    subAccountId: ctx.user.subAccountId,
    accessRole: ctx.user.accessRole,
    salesRoleSlugs: ctx.user.salesRoleSlugs,
    isSuperadmin: ctx.user.isSuperadmin,
  })),
  agent: buildAgentRouter(),
  tasks: tasksRouter,
  onboarding: onboardingRouter,
  roles: rolesRouter,
  funnel: funnelRouter,
  dispositions: dispositionsRouter,
});

export type AppRouter = typeof appRouter;
