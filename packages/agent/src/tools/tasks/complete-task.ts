import { z } from "zod";
import { tasks as tasksDomain } from "@revops/domain";
import { can } from "@revops/auth/policy";
import { defineTool } from "../../define-tool";

export const completeTask = defineTool({
  name: "completeTask",
  category: "tasks",
  description: "Mark a task as completed. Idempotent — already-completed tasks return ok=true.",
  input: z.object({ taskId: z.string().uuid() }),
  output: z.object({ completed: z.boolean() }),
  authorize: ({ ctx }) => can(ctx.user, "task:complete"),
  risk: "low",
  reversible: true,
  idempotent: true,
  idempotencyKey: ({ input }) => `completeTask:${input.taskId}`,
  run: async ({ ctx, input }) => {
    if (!ctx.subAccountId) throw new Error("subAccountId required");
    return tasksDomain.completeTask(ctx.db, {
      taskId: input.taskId,
      completedBy: ctx.user.userId,
      subAccountId: ctx.subAccountId,
    });
  },
});
