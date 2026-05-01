import { z } from "zod";
import { calls as callsDomain } from "@revops/domain";
import { can } from "@revops/auth/policy";
import { defineTool } from "../../define-tool";

export const setCallDisposition = defineTool({
  name: "setCallDisposition",
  category: "calls",
  description:
    "Set the disposition (e.g. won, no_show, rescheduled) on a call. Idempotent — re-running with the same dispositionId is a no-op. Emits a funnel event keyed to the disposition's category.",
  input: z.object({
    callId: z.string().uuid(),
    dispositionId: z.string().uuid(),
  }),
  output: z.object({
    callId: z.string(),
    dispositionId: z.string(),
  }),
  authorize: ({ ctx }) => can(ctx.user, "call:update"),
  risk: "low",
  reversible: true,
  idempotent: true,
  idempotencyKey: ({ input }) => `setCallDisposition:${input.callId}:${input.dispositionId}`,
  run: async ({ ctx, input }) => {
    if (!ctx.subAccountId) throw new Error("subAccountId required");
    await callsDomain.setDisposition(ctx.db, {
      callId: input.callId,
      workspaceId: ctx.workspaceId,
      subAccountId: ctx.subAccountId,
      dispositionId: input.dispositionId,
      actorUserId: ctx.user.userId,
    });
    return { callId: input.callId, dispositionId: input.dispositionId };
  },
});
