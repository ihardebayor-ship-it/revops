// Aircall webhook receiver. Auth is via the shared payload.token compared
// to AIRCALL_WEBHOOK_TOKEN. Idempotency key is `${event}:${data.id}` so
// call.created and call.ended on the same call dedup separately.

import { sql } from "drizzle-orm";
import { bypassRls, schema } from "@revops/db/client";
import { AIRCALL_PROVIDER_ID, verifyAircallToken } from "@revops/integrations/aircall";
import { inngest } from "@revops/jobs";

export async function POST(req: Request) {
  const rawBody = await req.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const verified = verifyAircallToken(typeof payload.token === "string" ? payload.token : undefined);
  if (!verified && process.env.NODE_ENV === "production") {
    return new Response("Bad token", { status: 401 });
  }

  const eventType = String(payload.event ?? "");
  const data = payload.data as { id?: string | number } | undefined;
  if (!data?.id) return Response.json({ ok: true, skipped: "no_id" });
  const externalId = `${eventType}:${data.id}`;

  const inboundId = await bypassRls(async (db) => {
    const inserted = await db
      .insert(schema.webhookInboundEvents)
      .values({
        source: AIRCALL_PROVIDER_ID,
        externalId,
        payload,
        signatureVerified: verified,
      })
      .onConflictDoNothing({
        target: [schema.webhookInboundEvents.source, schema.webhookInboundEvents.externalId],
      })
      .returning({ id: schema.webhookInboundEvents.id });
    if (inserted.length > 0) return inserted[0]!.id;
    const [existing] = await db
      .select({ id: schema.webhookInboundEvents.id })
      .from(schema.webhookInboundEvents)
      .where(
        sql`${schema.webhookInboundEvents.source} = ${AIRCALL_PROVIDER_ID} AND ${schema.webhookInboundEvents.externalId} = ${externalId}`,
      )
      .limit(1);
    return existing?.id ?? null;
  });
  if (!inboundId) return Response.json({ ok: true, dedup: true });

  let dispatched = false;
  try {
    await inngest.send({
      name: "aircall.webhook.received",
      data: { inboundEventId: inboundId },
    });
    dispatched = true;
  } catch (err) {
    if (process.env.NODE_ENV === "production") throw err;
    console.warn("[aircall webhook] inngest.send failed (dev):", err instanceof Error ? err.message : err);
  }

  return Response.json({ ok: true, inboundEventId: inboundId, dispatched });
}
