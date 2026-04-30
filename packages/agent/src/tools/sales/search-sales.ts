import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { sales } from "@revops/db/schema";
import { can } from "@revops/auth/policy";
import { defineTool } from "../../define-tool";

export const searchSales = defineTool({
  name: "searchSales",
  category: "sales",
  description: "Search sales in the current workspace. Returns most recent first.",
  input: z.object({
    limit: z.number().int().min(1).max(50).default(20),
    onlyUnlinked: z.boolean().default(false),
  }),
  output: z.object({
    sales: z.array(
      z.object({
        id: z.string(),
        productName: z.string().nullable(),
        bookedAmount: z.string(),
        collectedAmount: z.string(),
        currency: z.string(),
        closedAt: z.string(),
        linkedCallId: z.string().nullable(),
      }),
    ),
  }),
  authorize: ({ ctx }) => can(ctx.user, "sale:read"),
  risk: "low",
  reversible: true,
  idempotent: true,
  run: async ({ ctx, input }) => {
    const conditions = [eq(sales.workspaceId, ctx.workspaceId), isNull(sales.deletedAt)];
    if (input.onlyUnlinked) conditions.push(isNull(sales.linkedCallId));

    const rows = await ctx.db
      .select({
        id: sales.id,
        productName: sales.productName,
        bookedAmount: sales.bookedAmount,
        collectedAmount: sales.collectedAmount,
        currency: sales.currency,
        closedAt: sales.closedAt,
        linkedCallId: sales.linkedCallId,
      })
      .from(sales)
      .where(and(...conditions))
      .orderBy(desc(sales.closedAt))
      .limit(input.limit);

    return {
      sales: rows.map((r) => ({
        ...r,
        closedAt: r.closedAt.toISOString(),
      })),
    };
  },
});
