import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { calls as callsDomain } from "@revops/domain";
import { router, authedProcedure } from "../server";

export const callsRouter = router({
  list: authedProcedure
    .input(
      z.object({
        setterUserId: z.string().nullable().optional(),
        closerUserId: z.string().nullable().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user.subAccountId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Sub-account required" });
      }
      return callsDomain.listCalls(ctx.db, {
        subAccountId: ctx.user.subAccountId,
        setterUserId: input.setterUserId ?? null,
        closerUserId: input.closerUserId ?? null,
        limit: input.limit,
      });
    }),

  byId: authedProcedure
    .input(z.object({ callId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      return callsDomain.getCall(ctx.db, {
        callId: input.callId,
        workspaceId: ctx.user.workspaceId,
      });
    }),

  create: authedProcedure
    .input(
      z.object({
        contactName: z.string().max(200).optional(),
        contactEmail: z.string().email().optional(),
        contactPhone: z.string().max(50).optional(),
        appointmentAt: z.string().datetime().optional(),
        setterUserId: z.string().nullable().optional(),
        closerUserId: z.string().nullable().optional(),
        notes: z.string().max(5000).optional(),
        recordingConsent: z
          .enum(["one_party", "two_party", "unknown", "declined"])
          .default("unknown"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId || !ctx.user.subAccountId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Workspace required" });
      }
      // Default closer to the calling user when not specified — covers the
      // Solo preset where the same person logs and runs the call.
      const closerUserId =
        input.closerUserId === undefined ? ctx.user.userId : input.closerUserId;
      return callsDomain.createCall(ctx.db, {
        workspaceId: ctx.user.workspaceId,
        subAccountId: ctx.user.subAccountId,
        contactName: input.contactName ?? null,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        appointmentAt: input.appointmentAt ? new Date(input.appointmentAt) : null,
        setterUserId: input.setterUserId ?? null,
        closerUserId,
        notes: input.notes ?? null,
        recordingConsent: input.recordingConsent,
        createdBy: ctx.user.userId,
      });
    }),

  update: authedProcedure
    .input(
      z.object({
        callId: z.string().uuid(),
        contactName: z.string().nullable().optional(),
        contactEmail: z.string().email().nullable().optional(),
        contactPhone: z.string().nullable().optional(),
        appointmentAt: z.string().datetime().nullable().optional(),
        notes: z.string().nullable().optional(),
        recordingConsent: z
          .enum(["one_party", "two_party", "unknown", "declined"])
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      const patch: Record<string, unknown> = {};
      if (input.contactName !== undefined) patch.contactName = input.contactName;
      if (input.contactEmail !== undefined) patch.contactEmail = input.contactEmail;
      if (input.contactPhone !== undefined) patch.contactPhone = input.contactPhone;
      if (input.appointmentAt !== undefined) {
        patch.appointmentAt = input.appointmentAt ? new Date(input.appointmentAt) : null;
      }
      if (input.notes !== undefined) patch.notes = input.notes;
      if (input.recordingConsent !== undefined) patch.recordingConsent = input.recordingConsent;
      return callsDomain.updateCall(ctx.db, {
        callId: input.callId,
        workspaceId: ctx.user.workspaceId,
        patch,
      });
    }),

  setDisposition: authedProcedure
    .input(z.object({ callId: z.string().uuid(), dispositionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId || !ctx.user.subAccountId) {
        throw new TRPCError({ code: "BAD_REQUEST" });
      }
      return callsDomain.setDisposition(ctx.db, {
        callId: input.callId,
        workspaceId: ctx.user.workspaceId,
        subAccountId: ctx.user.subAccountId,
        dispositionId: input.dispositionId,
        actorUserId: ctx.user.userId,
      });
    }),

  setOutcome: authedProcedure
    .input(
      z.object({
        callId: z.string().uuid(),
        showedAt: z.string().datetime().nullable().optional(),
        pitchedAt: z.string().datetime().nullable().optional(),
        completedAt: z.string().datetime().nullable().optional(),
        durationSeconds: z.number().int().min(0).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId || !ctx.user.subAccountId) {
        throw new TRPCError({ code: "BAD_REQUEST" });
      }
      const toDate = (v: string | null | undefined): Date | null | undefined =>
        v == null ? v : new Date(v);
      return callsDomain.setOutcome(ctx.db, {
        callId: input.callId,
        workspaceId: ctx.user.workspaceId,
        subAccountId: ctx.user.subAccountId,
        showedAt: toDate(input.showedAt),
        pitchedAt: toDate(input.pitchedAt),
        completedAt: toDate(input.completedAt),
        durationSeconds: input.durationSeconds,
        actorUserId: ctx.user.userId,
      });
    }),

  linkOptin: authedProcedure
    .input(z.object({ callId: z.string().uuid(), optinId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId || !ctx.user.subAccountId) {
        throw new TRPCError({ code: "BAD_REQUEST" });
      }
      return callsDomain.linkOptin(ctx.db, {
        callId: input.callId,
        optinId: input.optinId,
        workspaceId: ctx.user.workspaceId,
        subAccountId: ctx.user.subAccountId,
        actorUserId: ctx.user.userId,
      });
    }),

  softDelete: authedProcedure
    .input(z.object({ callId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });
      return callsDomain.softDeleteCall(ctx.db, {
        callId: input.callId,
        workspaceId: ctx.user.workspaceId,
      });
    }),
});
