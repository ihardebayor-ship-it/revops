import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { schema } from "@revops/db/client";
import { router, authedProcedure } from "../server";

export const onboardingRouter = router({
  getStatus: authedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.workspaceId) {
      return { needsOnboarding: true, workspace: null };
    }
    const [ws] = await ctx.db
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        slug: schema.workspaces.slug,
        topologyPreset: schema.workspaces.topologyPreset,
      })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ctx.user.workspaceId))
      .limit(1);
    return { needsOnboarding: !ws, workspace: ws ?? null };
  }),

  // Phase 1 expansion: M1 ships getStatus only. selectTopology + complete
  // (which re-bootstraps the workspace with a different preset) lands when
  // the wizard UI is ready and we can validate that the user has no
  // sales/calls before resetting taxonomies.
  markComplete: authedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (input.workspaceId !== ctx.user.workspaceId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await ctx.db
        .update(schema.workspaceSettings)
        .set({
          metadata: { onboardingCompletedAt: new Date().toISOString() },
          updatedAt: new Date(),
        })
        .where(and(eq(schema.workspaceSettings.workspaceId, input.workspaceId)));
      return { ok: true };
    }),
});
