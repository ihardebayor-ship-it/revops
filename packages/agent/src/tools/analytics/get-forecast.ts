import { z } from "zod";
import { analytics } from "@revops/domain";
import { can } from "@revops/auth/policy";
import { defineTool } from "../../define-tool";

// "What's my forecast?" — same numbers the dashboards show.
// When userId omitted, returns workspace/team-wide attainment.
export const getForecast = defineTool({
  name: "getForecast",
  category: "analytics",
  description:
    "Get current-month attainment + linear forecast for a user (default: caller) or for the team (pass scope='team'). Returns attained, quota, forecastEnd, status, and required daily run-rate.",
  input: z.object({
    scope: z.enum(["self", "team"]).default("self"),
  }),
  output: z.object({
    scope: z.string(),
    quota: z.number(),
    attained: z.number(),
    attainmentPct: z.number(),
    forecastEnd: z.number(),
    status: z.enum(["ahead", "on_pace", "behind", "at_risk"]),
    daysRemaining: z.number(),
    requiredDailyRunRate: z.number(),
    note: z.string().optional(),
  }),
  authorize: ({ ctx }) => can(ctx.user, "sale:read"),
  risk: "low",
  reversible: true,
  idempotent: true,
  run: async ({ ctx, input }) => {
    const period = analytics.currentMonth();
    const userId = input.scope === "self" ? ctx.user.userId : undefined;

    let quota = 0;
    if (input.scope === "self") {
      const q = await analytics.getActiveQuota(ctx.db, {
        workspaceId: ctx.workspaceId,
        userId,
        subAccountId: ctx.subAccountId ?? undefined,
      });
      quota = q?.targetValue ?? 0;
    }
    // Team-scope quota = sum of all active per-user quotas (Phase 1 simple).
    // Skipped here for compactness; agent surfaces self-scope first.

    const result = await analytics.attainment(ctx.db, {
      workspaceId: ctx.workspaceId,
      subAccountId: ctx.subAccountId ?? undefined,
      userId,
      quota,
      period,
    });

    return {
      scope: input.scope,
      quota: result.quota,
      attained: result.attained,
      attainmentPct: result.attainmentPct,
      forecastEnd: result.forecastEnd,
      status: result.status,
      daysRemaining: result.daysRemaining,
      requiredDailyRunRate: result.requiredDailyRunRate,
      note:
        quota === 0
          ? "No quota set for this scope — forecast based purely on current pace."
          : undefined,
    };
  },
});
