import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { tasks as tasksDomain } from "@revops/domain";
import { channelNames, emit, events } from "@revops/realtime";
import { router, authedProcedure } from "../server";

export const tasksRouter = router({
  list: authedProcedure
    .input(
      z.object({
        statuses: z
          .array(z.enum(["open", "snoozed", "completed", "dismissed"]))
          .default(["open", "snoozed"]),
        kinds: z.array(z.string()).optional(),
        assignedToMe: z.boolean().default(true),
        limit: z.number().int().min(1).max(200).default(50),
        cursor: z.string().nullable().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user.subAccountId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Sub-account context required for inbox",
        });
      }
      return tasksDomain.listTasks(ctx.db, {
        subAccountId: ctx.user.subAccountId,
        assignedUserId: input.assignedToMe ? ctx.user.userId : null,
        salesRoleSlugs: ctx.user.salesRoleSlugs,
        statuses: input.statuses,
        kinds: input.kinds as Parameters<typeof tasksDomain.listTasks>[1]["kinds"],
        limit: input.limit,
        cursor: input.cursor ?? null,
      });
    }),

  create: authedProcedure
    .input(
      z.object({
        kind: z.enum([
          "call_outcome_pending",
          "sale_unlinked",
          "follow_up_due",
          "no_show_recovery",
          "commission_approval",
          "refund_save",
          "agent_suggestion",
          "manager_one_on_one",
          "custom",
        ]),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        payload: z.record(z.unknown()).optional(),
        assignedUserId: z.string().nullable().optional(),
        salesRoleId: z.string().uuid().nullable().optional(),
        relatedEntityType: z.string().optional(),
        relatedEntityId: z.string().uuid().optional(),
        dueAt: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId || !ctx.user.subAccountId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Workspace/sub-account required" });
      }
      // assignedUserId not set → default to creator. A task created from
      // your inbox should land in your inbox. Pass `null` explicitly to
      // create an unassigned task (manager queue).
      const assignedUserId =
        input.assignedUserId === undefined ? ctx.user.userId : input.assignedUserId;
      const result = await tasksDomain.createTask(ctx.db, {
        workspaceId: ctx.user.workspaceId,
        subAccountId: ctx.user.subAccountId,
        kind: input.kind,
        title: input.title,
        description: input.description,
        payload: input.payload,
        assignedUserId,
        salesRoleId: input.salesRoleId ?? null,
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        createdBy: ctx.user.userId,
      });
      if (assignedUserId) {
        // Fire-and-forget; emit() swallows errors so realtime hiccups never
        // break the originating mutation.
        void emit(
          channelNames.inboxFor(ctx.user.workspaceId, assignedUserId),
          events.taskCreated,
          { taskId: result.id, kind: input.kind, title: input.title },
        );
      }
      return result;
    }),

  complete: authedProcedure
    .input(z.object({ taskId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.subAccountId || !ctx.user.workspaceId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Sub-account required" });
      }
      const result = await tasksDomain.completeTask(ctx.db, {
        taskId: input.taskId,
        completedBy: ctx.user.userId,
        subAccountId: ctx.user.subAccountId,
      });
      if (result.completed) {
        void emit(
          channelNames.inboxFor(ctx.user.workspaceId, ctx.user.userId),
          events.taskCompleted,
          { taskId: input.taskId },
        );
      }
      return result;
    }),

  snooze: authedProcedure
    .input(
      z.object({
        taskId: z.string().uuid(),
        snoozedUntil: z.string().datetime(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.subAccountId || !ctx.user.workspaceId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Sub-account required" });
      }
      const result = await tasksDomain.snoozeTask(ctx.db, {
        taskId: input.taskId,
        snoozedUntil: new Date(input.snoozedUntil),
        subAccountId: ctx.user.subAccountId,
      });
      if (result.snoozed) {
        void emit(
          channelNames.inboxFor(ctx.user.workspaceId, ctx.user.userId),
          events.taskSnoozed,
          { taskId: input.taskId, snoozedUntil: input.snoozedUntil },
        );
      }
      return result;
    }),
});
