// Test-only endpoint: rewinds an optin's submitted_at by N minutes so the
// SLA sweep treats it as past-deadline immediately. Refuses outside
// development. Phase 2+ replaces this with a proper feature flag.

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getAuth } from "@revops/auth/server";
import { bypassRls, schema } from "@revops/db/client";

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new Response("Disabled", { status: 404 });
  }
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json()) as { optinId?: string; minutes?: number };
  if (!body.optinId) return new Response("optinId required", { status: 400 });
  const minutes = body.minutes ?? 60;
  const newSubmittedAt = new Date(Date.now() - minutes * 60 * 1000);

  await bypassRls(async (db) => {
    await db
      .update(schema.optins)
      .set({ submittedAt: newSubmittedAt })
      .where(and(eq(schema.optins.id, body.optinId!)));
  });

  return Response.json({ ok: true, optinId: body.optinId, newSubmittedAt });
}
