// Fathom webhook receiver. Verify HMAC over raw body, idempotency-insert
// keyed by recording_id, ack 200, send fathom.webhook.received.

import { sql } from "drizzle-orm";
import { bypassRls, schema } from "@revops/db/client";
import { FATHOM_PROVIDER_ID, verifyFathomSignature } from "@revops/integrations/fathom";
import { inngest } from "@revops/jobs";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const verified = verifyFathomSignature(rawBody, {
    fathom: req.headers.get("x-fathom-signature"),
    webhook: req.headers.get("x-webhook-signature"),
  });
  if (!verified && process.env.NODE_ENV === "production") {
    return new Response("Bad signature", { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const recordingId = payload.recording_id;
  if (recordingId === undefined || recordingId === null) {
    return Response.json({ ok: true, skipped: "no_recording_id" });
  }
  const externalId = `recording:${String(recordingId)}`;

  const inboundId = await bypassRls(async (db) => {
    const inserted = await db
      .insert(schema.webhookInboundEvents)
      .values({
        source: FATHOM_PROVIDER_ID,
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
        sql`${schema.webhookInboundEvents.source} = ${FATHOM_PROVIDER_ID} AND ${schema.webhookInboundEvents.externalId} = ${externalId}`,
      )
      .limit(1);
    return existing?.id ?? null;
  });
  if (!inboundId) return Response.json({ ok: true, dedup: true });

  let dispatched = false;
  try {
    await inngest.send({
      name: "fathom.webhook.received",
      data: { inboundEventId: inboundId },
    });
    dispatched = true;
  } catch (err) {
    if (process.env.NODE_ENV === "production") throw err;
    console.warn("[fathom webhook] inngest.send failed (dev):", err instanceof Error ? err.message : err);
  }

  return Response.json({ ok: true, inboundEventId: inboundId, dispatched });
}
