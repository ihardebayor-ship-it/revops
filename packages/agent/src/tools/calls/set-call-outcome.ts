import { z } from "zod";
import { calls as callsDomain } from "@revops/domain";
import { can } from "@revops/auth/policy";
import { defineTool } from "../../define-tool";

export const setCallOutcome = defineTool({
  name: "setCallOutcome",
  category: "calls",
  description:
    "Mark when a call showed/pitched/completed and optionally set duration. Used to record progress mid-call. Not strictly idempotent — values overwrite each other.",
  input: z.object({
    callId: z.string().uuid(),
    showedAt: z.string().datetime().nullable().optional(),
    pitchedAt: z.string().datetime().nullable().optional(),
    completedAt: z.string().datetime().nullable().optional(),
    durationSeconds: z.number().int().min(0).max(86400).nullable().optional(),
  }),
  output: z.object({ callId: z.string() }),
  authorize: ({ ctx }) => can(ctx.user, "call:update"),
  risk: "medium",
  reversible: true,
  idempotent: false,
  run: async ({ ctx, input }) => {
    if (!ctx.subAccountId) throw new Error("subAccountId required");
    const toDate = (s: string | null | undefined): Date | null | undefined => {
      if (s === null) return null;
      if (s === undefined) return undefined;
      return new Date(s);
    };
    await callsDomain.setOutcome(ctx.db, {
      callId: input.callId,
      workspaceId: ctx.workspaceId,
      subAccountId: ctx.subAccountId,
      showedAt: toDate(input.showedAt),
      pitchedAt: toDate(input.pitchedAt),
      completedAt: toDate(input.completedAt),
      durationSeconds: input.durationSeconds,
      actorUserId: ctx.user.userId,
    });
    return { callId: input.callId };
  },
});
