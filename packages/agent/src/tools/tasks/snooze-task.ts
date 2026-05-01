import { z } from "zod";
import { tasks as tasksDomain } from "@revops/domain";
import { can } from "@revops/auth/policy";
import { defineTool } from "../../define-tool";

export const snoozeTask = defineTool({
  name: "snoozeTask",
  category: "tasks",
  description: "Snooze a task until a future timestamp. Idempotent on (taskId, snoozedUntil).",
  input: z.object({
    taskId: z.string().uuid(),
    snoozedUntil: z.string().datetime(),
  }),
  output: z.object({ snoozed: z.boolean() }),
  authorize: ({ ctx }) => can(ctx.user, "task:snooze"),
  risk: "low",
  reversible: true,
  idempotent: true,
  idempotencyKey: ({ input }) => `snoozeTask:${input.taskId}:${input.snoozedUntil}`,
  run: async ({ ctx, input }) => {
    if (!ctx.subAccountId) throw new Error("subAccountId required");
    return tasksDomain.snoozeTask(ctx.db, {
      taskId: input.taskId,
      snoozedUntil: new Date(input.snoozedUntil),
      subAccountId: ctx.subAccountId,
    });
  },
});
