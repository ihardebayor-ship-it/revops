import { z } from "zod";
import { tasks as tasksDomain } from "@revops/domain";
import { can } from "@revops/auth/policy";
import { defineTool } from "../../define-tool";

const TASK_KIND = z.enum([
  "call_outcome_pending",
  "sale_unlinked",
  "follow_up_due",
  "no_show_recovery",
  "commission_approval",
  "refund_save",
  "agent_suggestion",
  "manager_one_on_one",
  "custom",
]);

export const createTask = defineTool({
  name: "createTask",
  category: "tasks",
  description:
    "Create a task in the inbox. Pass uniqueKey to enforce idempotency — running with the same uniqueKey twice will not create a duplicate.",
  input: z.object({
    kind: TASK_KIND,
    title: z.string().min(1).max(200),
    description: z.string().nullable().optional(),
    assignedUserId: z.string().nullable().optional(),
    salesRoleId: z.string().uuid().nullable().optional(),
    relatedEntityType: z.enum(["call", "sale", "customer", "optin"]).nullable().optional(),
    relatedEntityId: z.string().uuid().nullable().optional(),
    dueAt: z.string().datetime().nullable().optional(),
    uniqueKey: z.string().nullable().optional(),
  }),
  output: z.object({
    taskId: z.string(),
    deduped: z.boolean(),
  }),
  authorize: ({ ctx }) => can(ctx.user, "task:create"),
  risk: "low",
  reversible: true,
  idempotent: true,
  idempotencyKey: ({ input }) => (input.uniqueKey ? `createTask:${input.uniqueKey}` : ""),
  run: async ({ ctx, input }) => {
    if (!ctx.subAccountId) throw new Error("subAccountId required");
    const args = {
      workspaceId: ctx.workspaceId,
      subAccountId: ctx.subAccountId,
      kind: input.kind,
      title: input.title,
      description: input.description ?? null,
      assignedUserId: input.assignedUserId ?? null,
      salesRoleId: input.salesRoleId ?? null,
      relatedEntityType: input.relatedEntityType ?? null,
      relatedEntityId: input.relatedEntityId ?? null,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
    };
    if (input.uniqueKey) {
      const result = await tasksDomain.upsertTaskByUniqueKey(ctx.db, {
        ...args,
        uniqueKey: input.uniqueKey,
      });
      if (!result.id) throw new Error("upsert returned no id");
      return { taskId: result.id, deduped: !result.inserted };
    }
    const created = await tasksDomain.createTask(ctx.db, args);
    return { taskId: created.id, deduped: false };
  },
});
