import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { optins as optinsDomain } from "@revops/domain";
import { router, authedProcedure } from "../server";

export const optinsRouter = router({
  list: authedProcedure
    .input(
      z.object({
        attributedToMe: z.boolean().default(false),
        pendingOnly: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user.subAccountId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Sub-account required" });
      }
      return optinsDomain.listOptins(ctx.db, {
        subAccountId: ctx.user.subAccountId,
        attributedToUserId: input.attributedToMe ? ctx.user.userId : null,
        pendingOnly: input.pendingOnly,
        limit: input.limit,
      });
    }),

  // M2 ships create as a tRPC mutation so the test endpoint and the
  // settings UI can spawn fixtures. Phase 1 M5 wires real form-webhook
  // intake (Typeform/JotForm) into the same domain function.
  create: authedProcedure
    .input(
      z.object({
        email: z.string().email(),
        name: z.string().max(200).optional(),
        phone: z.string().max(50).optional(),
        leadSource: z.string().max(100).optional(),
        utmSource: z.string().max(100).optional(),
        utmMedium: z.string().max(100).optional(),
        utmCampaign: z.string().max(100).optional(),
        submittedAt: z.string().datetime().optional(),
        attribute: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId || !ctx.user.subAccountId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Workspace required" });
      }
      return optinsDomain.createOptin(ctx.db, {
        workspaceId: ctx.user.workspaceId,
        subAccountId: ctx.user.subAccountId,
        email: input.email,
        name: input.name ?? null,
        phone: input.phone ?? null,
        leadSource: input.leadSource ?? null,
        utmSource: input.utmSource ?? null,
        utmMedium: input.utmMedium ?? null,
        utmCampaign: input.utmCampaign ?? null,
        submittedAt: input.submittedAt ? new Date(input.submittedAt) : new Date(),
        attribute: input.attribute,
        createdBy: ctx.user.userId,
      });
    }),
});
