// aircall.webhook.received → upsert call row.
//
// Resolution order:
//   1. Match by (sub_account_id, source_integration='aircall', external_id)
//      so call.created → call.ended on the same id reuses the row.
//   2. If no match yet: resolve via data_source_connections by aircall user.id
//      (stored as externalAccountId) → workspace + sub_account.
//   3. If still nothing: fall back to phone-number reconciliation against
//      a recent call window — but this is deferred to a followup. For now,
//      drop the event with a "no_connection" skip reason so dashboards
//      surface the gap.

import { NonRetriableError } from "inngest";
import { and, eq } from "drizzle-orm";
import { bypassRls, schema, type Db } from "@revops/db/client";
import {
  AIRCALL_PROVIDER_ID,
  aircallWebhookSchema,
  mapAircallCall,
} from "@revops/integrations/aircall";
import { funnel as funnelDomain } from "@revops/domain";
import { inngest } from "../client";

export type AircallProcessResult =
  | { skipped: true; reason: string }
  | { skipped: false; callId: string; createdNew: boolean };

export async function processAircallInboundEvent(
  db: Db,
  inboundEventId: string,
): Promise<AircallProcessResult> {
  const [row] = await db
    .select({
      id: schema.webhookInboundEvents.id,
      payload: schema.webhookInboundEvents.payload,
      processedAt: schema.webhookInboundEvents.processedAt,
    })
    .from(schema.webhookInboundEvents)
    .where(eq(schema.webhookInboundEvents.id, inboundEventId))
    .limit(1);
  if (!row) throw new NonRetriableError(`Inbound event ${inboundEventId} not found`);
  if (row.processedAt) return { skipped: true, reason: "already_processed" };

  const parsed = aircallWebhookSchema.safeParse(row.payload);
  if (!parsed.success) {
    await db
      .update(schema.webhookInboundEvents)
      .set({ processedAt: new Date(), error: `Schema invalid: ${parsed.error.message}` })
      .where(eq(schema.webhookInboundEvents.id, row.id));
    throw new NonRetriableError(`Payload invalid: ${parsed.error.message}`);
  }
  const payload = parsed.data;
  const aircallUserId = payload.data.user?.id ? String(payload.data.user.id) : null;

  if (!aircallUserId) {
    await db
      .update(schema.webhookInboundEvents)
      .set({ processedAt: new Date(), error: "no user.id on payload" })
      .where(eq(schema.webhookInboundEvents.id, row.id));
    return { skipped: true, reason: "no_user_id" };
  }

  const [conn] = await db
    .select({
      workspaceId: schema.dataSourceConnections.workspaceId,
      subAccountId: schema.dataSourceConnections.subAccountId,
    })
    .from(schema.dataSourceConnections)
    .where(
      and(
        eq(schema.dataSourceConnections.toolType, AIRCALL_PROVIDER_ID),
        eq(schema.dataSourceConnections.externalAccountId, aircallUserId),
      ),
    )
    .limit(1);
  if (!conn) {
    await db
      .update(schema.webhookInboundEvents)
      .set({
        processedAt: new Date(),
        error: `No connection for aircall user_id=${aircallUserId}`,
      })
      .where(eq(schema.webhookInboundEvents.id, row.id));
    return { skipped: true, reason: "no_connection_for_user" };
  }

  const mapped = mapAircallCall(payload.event, payload.data);

  const [existing] = await db
    .select({ id: schema.calls.id })
    .from(schema.calls)
    .where(
      and(
        eq(schema.calls.subAccountId, conn.subAccountId),
        eq(schema.calls.sourceIntegration, AIRCALL_PROVIDER_ID),
        eq(schema.calls.externalId, mapped.externalId),
      ),
    )
    .limit(1);

  let callId: string;
  let createdNew = false;
  if (existing) {
    await db
      .update(schema.calls)
      .set({
        appointmentAt: mapped.appointmentAt,
        contactName: mapped.contactName,
        contactEmail: mapped.contactEmail,
        contactPhone: mapped.contactPhone,
        durationSeconds: mapped.durationSeconds,
        recordingUrl: mapped.recordingUrl,
        metadata: mapped.metadata,
        updatedAt: new Date(),
      })
      .where(eq(schema.calls.id, existing.id));
    callId = existing.id;
  } else {
    const [inserted] = await db
      .insert(schema.calls)
      .values({
        workspaceId: conn.workspaceId,
        subAccountId: conn.subAccountId,
        contactName: mapped.contactName,
        contactEmail: mapped.contactEmail,
        contactPhone: mapped.contactPhone,
        appointmentAt: mapped.appointmentAt,
        durationSeconds: mapped.durationSeconds,
        recordingUrl: mapped.recordingUrl,
        sourceIntegration: AIRCALL_PROVIDER_ID,
        externalId: mapped.externalId,
        metadata: mapped.metadata,
      })
      .returning({ id: schema.calls.id });
    if (!inserted) throw new Error("Failed to insert call");
    callId = inserted.id;
    createdNew = true;
  }

  // Emit a funnel event only on call.ended so we don't double-count
  // create→end transitions.
  if (payload.event === "call.ended") {
    await funnelDomain.emitFunnelEvent(db, {
      workspaceId: conn.workspaceId,
      subAccountId: conn.subAccountId,
      entityType: "call",
      entityId: callId,
      stageSlug: "completed",
      occurredAt: mapped.appointmentAt,
      sourceEventId: row.id,
      meta: { via: "aircall.webhook", direction: mapped.direction ?? null },
    });
  }

  await db
    .update(schema.webhookInboundEvents)
    .set({ processedAt: new Date() })
    .where(eq(schema.webhookInboundEvents.id, row.id));

  return { skipped: false, callId, createdNew };
}

export const aircallWebhookHandler = inngest.createFunction(
  {
    id: "aircall-webhook-handler",
    concurrency: { limit: 20 },
    retries: 3,
  },
  { event: "aircall.webhook.received" },
  async ({ event, step }) => {
    const { inboundEventId } = event.data;
    return step
      .run("process", () => bypassRls((db) => processAircallInboundEvent(db, inboundEventId)))
      .catch((err) => {
        if (err instanceof NonRetriableError) throw err;
        throw new Error(
          `Aircall webhook handler failed: ${err instanceof Error ? err.message : err}`,
        );
      });
  },
);
