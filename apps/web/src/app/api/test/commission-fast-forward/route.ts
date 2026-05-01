// Test-only endpoint: rewinds pending_until / available_at on a sale's
// commission entries by N days so the hold-release cron treats them as
// past-deadline immediately. Refuses outside development.

import { and, eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { getAuth } from "@revops/auth/server";
import { bypassRls, schema } from "@revops/db/client";

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new Response("Disabled", { status: 404 });
  }
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json()) as { saleId?: string; days?: number };
  if (!body.saleId) return new Response("saleId required", { status: 400 });
  const days = body.days ?? 31;

  const updated = await bypassRls(async (db) => {
    const rows = await db
      .update(schema.commissionEntries)
      .set({
        pendingUntil: sql`${schema.commissionEntries.pendingUntil} - (${days} || ' days')::interval`,
        availableAt: sql`${schema.commissionEntries.availableAt} - (${days} || ' days')::interval`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.commissionEntries.saleId, body.saleId!),
          eq(schema.commissionEntries.status, "pending"),
        ),
      )
      .returning({ id: schema.commissionEntries.id });
    return rows.length;
  });

  return Response.json({ ok: true, saleId: body.saleId, days, updated });
}
