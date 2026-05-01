// User feedback on agent_facts. The agent calls these tools after the
// user implicitly confirms or contradicts something the agent stated
// (e.g. "yes, that's right" or "no, we changed that policy last week").
//
// confirmFact bumps confidence to 1.0 and stamps confirmedByUserAt.
// contradictFact stamps contradictedAt; the memory hydration query in
// M5.5 filters out facts where contradictedAt is set.

import { z } from "zod";
import { eq } from "drizzle-orm";
import { agentFacts } from "@revops/db/schema";
import { can } from "@revops/auth/policy";
import { defineTool } from "../../define-tool";

export const confirmFact = defineTool({
  name: "confirmFact",
  category: "memory",
  description: "Mark an agent_facts row as confirmed by the user. Bumps confidence to 1.0.",
  input: z.object({ factId: z.string().uuid() }),
  output: z.object({ factId: z.string(), confirmed: z.boolean() }),
  authorize: ({ ctx }) => can(ctx.user, "agent:fact:write"),
  risk: "low",
  reversible: true,
  idempotent: true,
  idempotencyKey: ({ input }) => `confirmFact:${input.factId}`,
  run: async ({ ctx, input }) => {
    const result = await ctx.db
      .update(agentFacts)
      .set({
        confirmedByUserAt: new Date(),
        contradictedAt: null,
        confidence: "1.00",
        updatedAt: new Date(),
      })
      .where(eq(agentFacts.id, input.factId))
      .returning({ id: agentFacts.id });
    return { factId: input.factId, confirmed: result.length > 0 };
  },
});

export const contradictFact = defineTool({
  name: "contradictFact",
  category: "memory",
  description:
    "Mark an agent_facts row as contradicted (e.g. the policy changed). Filtered out of future memory hydration but kept for history.",
  input: z.object({ factId: z.string().uuid() }),
  output: z.object({ factId: z.string(), contradicted: z.boolean() }),
  authorize: ({ ctx }) => can(ctx.user, "agent:fact:write"),
  risk: "low",
  reversible: true,
  idempotent: true,
  idempotencyKey: ({ input }) => `contradictFact:${input.factId}`,
  run: async ({ ctx, input }) => {
    const result = await ctx.db
      .update(agentFacts)
      .set({
        contradictedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agentFacts.id, input.factId))
      .returning({ id: agentFacts.id });
    return { factId: input.factId, contradicted: result.length > 0 };
  },
});
