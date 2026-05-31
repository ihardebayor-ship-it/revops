import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { schema } from "@revops/db/client";
import { onboarding as onboardingDomain, goals as goalsDomain } from "@revops/domain";
import { router, authedProcedure, authedProcedureWith } from "../server";

const TOPOLOGY_PRESET = z.enum(["solo", "setter_closer", "setter_closer_cx", "custom"]);

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

  // Rename the workspace (and update slug-derived display where it shows).
  // Slug stays stable so URLs don't break.
  updateWorkspaceName: authedProcedureWith("workspace:update")
    .input(z.object({ name: z.string().min(2).max(80) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      await ctx.db
        .update(schema.workspaces)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(schema.workspaces.id, ctx.user.workspaceId));
      return { ok: true };
    }),

  // Switch topology preset (re-bootstrap roles + funnel + dispositions +
  // default commission rules from the new preset). Domain layer refuses
  // if any sales/calls already exist; tRPC surfaces the reason.
  applyTopology: authedProcedureWith("workspace:update")
    .input(z.object({ preset: TOPOLOGY_PRESET }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      const result = await onboardingDomain.applyTopologyPreset({
        workspaceId: ctx.user.workspaceId,
        preset: input.preset,
        actorUserId: ctx.user.userId,
      });
      if (!result.applied) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: result.reason });
      }
      return result;
    }),

  // Set the calling user's first quota for the current month. This is
  // the bridge between sign-up and the closer/setter dashboards rendering
  // a real forecast instead of a "no quota set" fallback.
  setFirstQuota: authedProcedureWith("workspace:update")
    .input(
      z.object({
        targetValue: z.string().regex(/^\d+(\.\d{1,2})?$/, "Decimal amount required"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId || !ctx.user.subAccountId) {
        throw new TRPCError({ code: "BAD_REQUEST" });
      }
      const now = new Date();
      const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
        .toISOString()
        .slice(0, 10);
      const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
        .toISOString()
        .slice(0, 10);
      return goalsDomain.createGoal(ctx.db, {
        workspaceId: ctx.user.workspaceId,
        subAccountId: ctx.user.subAccountId,
        actorUserId: ctx.user.userId,
        kind: "quota",
        metric: "booked_amount",
        targetValue: input.targetValue,
        currency: "USD",
        periodKind: "monthly",
        periodStart,
        periodEnd,
        userId: ctx.user.userId,
      });
    }),

  markComplete: authedProcedureWith("workspace:update").mutation(async ({ ctx }) => {
    if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
    await ctx.db
      .update(schema.workspaceSettings)
      .set({
        metadata: { onboardingCompletedAt: new Date().toISOString() },
        updatedAt: new Date(),
      })
      .where(and(eq(schema.workspaceSettings.workspaceId, ctx.user.workspaceId)));
    return { ok: true };
  }),
});
