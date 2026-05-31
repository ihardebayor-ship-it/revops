// Test-only endpoint: rewinds an optin's submitted_at by N minutes so the
// SLA sweep treats it as past-deadline immediately. Requires explicit
// enablement plus platform-superadmin access.

import { and, eq } from "drizzle-orm";
import { bypassRls, schema } from "@revops/db/client";
import { requireTestEndpointAccess } from "../_guard";

export async function POST(req: Request) {
  const access = await requireTestEndpointAccess();
  if (access instanceof Response) return access;

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
