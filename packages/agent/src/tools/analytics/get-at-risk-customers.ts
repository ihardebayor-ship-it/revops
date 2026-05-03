import { z } from "zod";
import { analytics } from "@revops/domain";
import { can } from "@revops/auth/policy";
import { defineTool } from "../../define-tool";

// "Who's at risk on my book?" — same surface the CX dashboard uses,
// available in chat so the agent can proactively ping reps.
export const getAtRiskCustomers = defineTool({
  name: "getAtRiskCustomers",
  category: "analytics",
  description:
    "List customers most at risk in the workspace, ranked by risk score × LTV. Returns up to 25 with their risk score, days-since-touch, and the signals that drove the score (silence, refund, negative disposition).",
  input: z.object({
    limit: z.number().int().min(1).max(25).default(10),
  }),
  output: z.object({
    customers: z.array(
      z.object({
        customerId: z.string(),
        email: z.string(),
        name: z.string().nullable(),
        lifetimeValue: z.string(),
        riskScore: z.number(),
        daysSinceLastTouch: z.number(),
        signals: z.array(z.string()),
      }),
    ),
  }),
  authorize: ({ ctx }) => can(ctx.user, "sale:read"),
  risk: "low",
  reversible: true,
  idempotent: true,
  run: async ({ ctx, input }) => {
    const customers = await analytics.customersNeedingTouch(ctx.db, {
      workspaceId: ctx.workspaceId,
      subAccountId: ctx.subAccountId ?? undefined,
      limit: input.limit,
    });
    return { customers };
  },
});
