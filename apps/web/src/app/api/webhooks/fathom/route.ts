// Fathom webhook receiver. Verify HMAC over raw body, idempotency-insert
// keyed by provider account + recording_id, ack 200, send fathom.webhook.received.

import { and, eq } from "drizzle-orm";
import { bypassRls, schema } from "@revops/db/client";
import {
  FATHOM_PROVIDER_ID,
  verifyFathomSignature,
  verifyFathomWebhookScope,
} from "@revops/integrations/fathom";
import { inngest } from "@revops/jobs";
import { logger } from "@revops/observability";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const url = new URL(req.url);
  const scopeKey = url.searchParams.get("key");
  if (!scopeKey) {
    return new Response("Missing webhook key", { status: 401 });
  }
  const scope = verifyFathomWebhookScope(scopeKey, getFathomWebhookKeySecret());
  if (!scope) {
    return new Response("Bad webhook key", { status: 401 });
  }
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
    logger.info("webhook.skipped", { source: FATHOM_PROVIDER_ID, reason: "no_recording_id" });
    return Response.json({ ok: true, skipped: "no_recording_id" });
  }
  const providerAccountId = scope.subAccountId
    ? `subAccount:${scope.subAccountId}`
    : `workspace:${scope.workspaceId}`;
  const externalId = `recording:${String(recordingId)}`;

  const inboundId = await bypassRls(async (db) => {
    const inserted = await db
      .insert(schema.webhookInboundEvents)
      .values({
        source: FATHOM_PROVIDER_ID,
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
    if (inserted.length > 0) {
      logger.info("webhook.received", {
        source: FATHOM_PROVIDER_ID,
        providerAccountId,
        externalId,
        inboundEventId: inserted[0]!.id,
      });
      return inserted[0]!.id;
    }
    const [existing] = await db
      .select({ id: schema.webhookInboundEvents.id })
      .from(schema.webhookInboundEvents)
      .where(
        and(
          eq(schema.webhookInboundEvents.source, FATHOM_PROVIDER_ID),
          eq(schema.webhookInboundEvents.providerAccountId, providerAccountId),
          eq(schema.webhookInboundEvents.externalId, externalId),
        ),
      )
      .limit(1);
    logger.info("webhook.dedup", {
      source: FATHOM_PROVIDER_ID,
      providerAccountId,
      externalId,
      inboundEventId: existing?.id ?? null,
    });
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
    logger.warn("webhook.dispatch_failed", {
      source: FATHOM_PROVIDER_ID,
      inboundEventId: inboundId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return Response.json({ ok: true, inboundEventId: inboundId, dispatched });
}

function getFathomWebhookKeySecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET ?? process.env.FATHOM_WEBHOOK_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET or FATHOM_WEBHOOK_SECRET is required");
  return secret;
}
