import { z } from "zod";
import { analytics } from "@revops/domain";
import { can } from "@revops/auth/policy";
import { defineTool } from "../../define-tool";

// "How is the team doing?" — manager-style chat query.
// Manager+ only because surfacing per-rep numbers is a privacy boundary.
export const getTeamLeaderboard = defineTool({
  name: "getTeamLeaderboard",
  category: "analytics",
  description:
    "Get the per-rep current-month leaderboard with WoW trend, vs-median fairness lens, closes count, and forward pipeline count. Manager-only.",
  input: z.object({}),
  output: z.object({
    period: z.object({ from: z.string(), to: z.string() }),
    entries: z.array(
      z.object({
        userId: z.string(),
        name: z.string().nullable(),
        email: z.string(),
        attained: z.number(),
        attainmentTrend: z.enum(["up", "down", "flat"]),
        attainmentDeltaPct: z.number().nullable(),
        closesCount: z.number(),
        pipelineCount: z.number(),
        vsMedian: z.number().nullable(),
      }),
    ),
  }),
  authorize: ({ ctx }) => {
    // Per-rep visibility is a manager-or-up privilege.
    if (ctx.user.isSuperadmin) return true;
    if (ctx.user.accessRole === "workspace_admin") return true;
    if (ctx.user.accessRole === "sub_account_admin") return true;
    if (ctx.user.accessRole === "manager") return true;
    return can(ctx.user, "sale:read") && false; // explicit fallthrough
  },
  risk: "low",
  reversible: true,
  idempotent: true,
  run: async ({ ctx }) => {
    const period = analytics.currentMonth();
    const entries = await analytics.leaderboard(ctx.db, {
      workspaceId: ctx.workspaceId,
      subAccountId: ctx.subAccountId ?? undefined,
      period,
    });
    return {
      period: {
        from: period.from.toISOString(),
        to: period.to.toISOString(),
      },
      entries,
    };
  },
});
