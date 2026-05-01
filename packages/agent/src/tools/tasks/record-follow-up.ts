import { z } from "zod";
import { tasks as tasksDomain } from "@revops/domain";
import { can } from "@revops/auth/policy";
import { defineTool } from "../../define-tool";

// Convenience wrapper around createTask: builds a templated follow-up
// task pointed at a customer/call/sale. The agent uses this rather than
// createTask when it's reminding a rep to follow up — the title and
// uniqueKey are formatted consistently so the inbox groups them.

export const recordFollowUp = defineTool({
  name: "recordFollowUp",
  category: "tasks",
  description:
    "Schedule a follow-up task. Templated wrapper around createTask. Pass dueAt + a short reason. Idempotent: re-running with the same (relatedEntityId, dueDay) is a no-op.",
  input: z.object({
    relatedEntityType: z.enum(["call", "sale", "customer"]),
    relatedEntityId: z.string().uuid(),
    assignedUserId: z.string().nullable().optional(),
    dueAt: z.string().datetime(),
    reason: z.string().min(1).max(500),
  }),
  output: z.object({ taskId: z.string(), deduped: z.boolean() }),
  authorize: ({ ctx }) => can(ctx.user, "task:create"),
  risk: "low",
  reversible: true,
  idempotent: true,
  run: async ({ ctx, input }) => {
    if (!ctx.subAccountId) throw new Error("subAccountId required");
    const dueDay = input.dueAt.slice(0, 10);
    const uniqueKey = `follow_up:${input.relatedEntityType}:${input.relatedEntityId}:${dueDay}`;
    const result = await tasksDomain.upsertTaskByUniqueKey(ctx.db, {
      workspaceId: ctx.workspaceId,
      subAccountId: ctx.subAccountId,
      kind: "follow_up_due",
      title: `Follow up: ${input.reason.slice(0, 80)}`,
      description: input.reason,
      assignedUserId: input.assignedUserId ?? null,
      salesRoleId: null,
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
      dueAt: new Date(input.dueAt),
      uniqueKey,
    });
    if (!result.id) throw new Error("upsert returned no id");
    return { taskId: result.id, deduped: !result.inserted };
  },
});
