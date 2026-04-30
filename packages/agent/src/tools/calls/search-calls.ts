// Read-only example tool. See ADR-0003 §13 — Phase 0 ships read-only tools so
// the agent can be exercised against real data with zero mutation risk.
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { calls } from "@revops/db/schema";
import { can } from "@revops/auth/policy";
import { defineTool } from "../../define-tool";

export const searchCalls = defineTool({
  name: "searchCalls",
  category: "calls",
  description:
    "Search calls in the current workspace. Returns most recent first. Use this when " +
    "the user asks about specific calls, recent activity, or wants to find a call to " +
    "act on.",
  input: z.object({
    limit: z.number().int().min(1).max(50).default(20),
    closerUserId: z.string().optional(),
    setterUserId: z.string().optional(),
  }),
  output: z.object({
    calls: z.array(
      z.object({
        id: z.string(),
        appointmentAt: z.string().nullable(),
        contactEmail: z.string().nullable(),
        contactName: z.string().nullable(),
        durationSeconds: z.number().nullable(),
      }),
    ),
  }),
  authorize: ({ ctx }) => can(ctx.user, "call:read"),
  risk: "low",
  reversible: true,
  idempotent: true,
  run: async ({ ctx, input }) => {
    const conditions = [
      eq(calls.workspaceId, ctx.workspaceId),
      isNull(calls.deletedAt),
    ];
    if (input.closerUserId) conditions.push(eq(calls.closerUserId, input.closerUserId));
    if (input.setterUserId) conditions.push(eq(calls.setterUserId, input.setterUserId));

    const rows = await ctx.db
      .select({
        id: calls.id,
        appointmentAt: calls.appointmentAt,
        contactEmail: calls.contactEmail,
        contactName: calls.contactName,
        durationSeconds: calls.durationSeconds,
      })
      .from(calls)
      .where(and(...conditions))
      .orderBy(desc(calls.appointmentAt))
      .limit(input.limit);

    return {
      calls: rows.map((r) => ({
        id: r.id,
        appointmentAt: r.appointmentAt?.toISOString() ?? null,
        contactEmail: r.contactEmail,
        contactName: r.contactName,
        durationSeconds: r.durationSeconds,
      })),
    };
  },
});
