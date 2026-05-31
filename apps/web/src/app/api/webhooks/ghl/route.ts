// GHL webhook receiver. Pattern shared across all providers:
//   1. Read raw body once
//   2. Verify signature
//   3. Insert into webhook_inbound_events (UNIQUE on source+provider account+external_id
//      gives us tenant-safe idempotency for free)
//   4. ack 200 fast, send Inngest event for async processing
//
// We always ack 200 even on dedup hit — providers retry on non-2xx and a
// duplicate is not a failure on our end.

import { and, eq } from "drizzle-orm";
import { bypassRls, schema } from "@revops/db/client";
import { GHL_PROVIDER_ID, verifyGhlSignature } from "@revops/integrations/ghl";
import { inngest } from "@revops/jobs";
import { logger } from "@revops/observability";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const sigHeader = req.headers.get("x-wh-signature");
  const verified = verifyGhlSignature(rawBody, sigHeader);
  // In development, allow unsigned webhooks for testing if no secret is set.
  if (!verified && process.env.NODE_ENV === "production") {
    return new Response("Bad signature", { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // GHL fires the same webhook URL for many event types; the unique key
  // is appointment.id (or contact.id) plus the eventType to keep distinct
  // create/update events from collapsing.
  const eventType = String(payload.type ?? "");
  const appointment = payload.appointment as { id?: string } | undefined;
  const contact = payload.contact as { id?: string } | undefined;
  const externalIdBase = appointment?.id ?? contact?.id;
  if (!externalIdBase) {
    logger.info("webhook.skipped", { source: GHL_PROVIDER_ID, reason: "no_id" });
    return Response.json({ ok: true, skipped: "no_id" });
  }
  const providerAccountId = typeof payload.locationId === "string" ? payload.locationId : null;
  if (!providerAccountId) {
    logger.info("webhook.skipped", {
      source: GHL_PROVIDER_ID,
      reason: "no_provider_account",
      externalIdBase,
    });
    return Response.json({ ok: true, skipped: "no_provider_account" });
  }
  const externalId = `${eventType}:${externalIdBase}`;

  const inboundId = await bypassRls(async (db) => {
    const result = await db
      .insert(schema.webhookInboundEvents)
      .values({
        source: GHL_PROVIDER_ID,
        providerAccountId,
        externalId,
        payload,
        signatureVerified: verified,
      })
      .onConflictDoNothing({
        target: [
          schema.webhookInboundEvents.source,
          schema.webhookInboundEvents.providerAccountId,
          schema.webhookInboundEvents.externalId,
        ],
      })
      .returning({ id: schema.webhookInboundEvents.id });
    if (result.length > 0) {
      logger.info("webhook.received", {
        source: GHL_PROVIDER_ID,
        providerAccountId,
        externalId,
        inboundEventId: result[0]!.id,
      });
      return result[0]!.id;
    }

    // Already received — fetch the existing row's id.
    const [existing] = await db
      .select({ id: schema.webhookInboundEvents.id })
      .from(schema.webhookInboundEvents)
      .where(
        and(
          eq(schema.webhookInboundEvents.source, GHL_PROVIDER_ID),
          eq(schema.webhookInboundEvents.providerAccountId, providerAccountId),
          eq(schema.webhookInboundEvents.externalId, externalId),
        ),
      )
      .limit(1);
    logger.info("webhook.dedup", {
      source: GHL_PROVIDER_ID,
      providerAccountId,
      externalId,
      inboundEventId: existing?.id ?? null,
    });
    return existing?.id ?? null;
  });

  if (!inboundId) return Response.json({ ok: true, dedup: true });

  // In dev without INNGEST_EVENT_KEY, the row is persisted but the handler
  // won't fire automatically. Surface the error in the response so it's
  // obvious; don't 500 because the inbound event IS recorded.
  let dispatched = false;
  try {
    await inngest.send({
      name: "ghl.webhook.received",
      data: { inboundEventId: inboundId },
    });
    dispatched = true;
  } catch (err) {
    if (process.env.NODE_ENV === "production") throw err;
    logger.warn("webhook.dispatch_failed", {
      source: GHL_PROVIDER_ID,
      inboundEventId: inboundId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return Response.json({ ok: true, inboundEventId: inboundId, dispatched });
}
