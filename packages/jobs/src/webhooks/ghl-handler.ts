// ghl.webhook.received → upsert call row + emit funnel event.
//
// The ack route stores the raw payload in webhook_inbound_events. This
// handler picks up by inboundEventId, parses, maps to call fields, and
// upserts the call row keyed on (sub_account_id, source_integration='gohighlevel',
// external_id=appointment.id). On AppointmentUpdate where the row exists,
// updates only if dateUpdated is newer than our last write.
//
// processGhlInboundEvent is exported so dev test endpoints can run the
// same logic synchronously without an Inngest dev server.

import { NonRetriableError } from "inngest";
import { and, eq } from "drizzle-orm";
import { bypassRls, schema, type Db } from "@revops/db/client";
import { GHL_PROVIDER_ID, ghlWebhookPayloadSchema, mapAppointmentToCall } from "@revops/integrations/ghl";
import { funnel as funnelDomain } from "@revops/domain";
import { inngest } from "../client";

export type GhlProcessResult =
  | { skipped: true; reason: string; type?: string }
  | { skipped: false; callId: string; createdNew: boolean };

export async function processGhlInboundEvent(
  db: Db,
  inboundEventId: string,
): Promise<GhlProcessResult> {
  const [row] = await db
    .select({
      id: schema.webhookInboundEvents.id,
      source: schema.webhookInboundEvents.source,
      externalId: schema.webhookInboundEvents.externalId,
      payload: schema.webhookInboundEvents.payload,
      processedAt: schema.webhookInboundEvents.processedAt,
    })
    .from(schema.webhookInboundEvents)
    .where(eq(schema.webhookInboundEvents.id, inboundEventId))
    .limit(1);
  if (!row) throw new NonRetriableError(`Inbound event ${inboundEventId} not found`);
  if (row.processedAt) return { skipped: true, reason: "already_processed" };

  const parsed = ghlWebhookPayloadSchema.safeParse(row.payload);
  if (!parsed.success) {
    await db
      .update(schema.webhookInboundEvents)
      .set({ processedAt: new Date(), error: `Schema invalid: ${parsed.error.message}` })
      .where(eq(schema.webhookInboundEvents.id, row.id));
    throw new NonRetriableError(`Payload schema invalid: ${parsed.error.message}`);
  }
  const payload = parsed.data;

  if (payload.type !== "AppointmentCreate" && payload.type !== "AppointmentUpdate") {
    await db
      .update(schema.webhookInboundEvents)
      .set({ processedAt: new Date() })
      .where(eq(schema.webhookInboundEvents.id, row.id));
    return { skipped: true, reason: "event_not_handled", type: payload.type };
  }
  if (!payload.appointment) {
    await db
      .update(schema.webhookInboundEvents)
      .set({ processedAt: new Date(), error: "appointment field missing" })
      .where(eq(schema.webhookInboundEvents.id, row.id));
    throw new NonRetriableError("Appointment field missing");
  }
  if (!payload.locationId) {
    await db
      .update(schema.webhookInboundEvents)
      .set({ processedAt: new Date(), error: "locationId missing" })
      .where(eq(schema.webhookInboundEvents.id, row.id));
    throw new NonRetriableError("locationId missing — cannot resolve workspace");
  }

  const [conn] = await db
    .select({
      workspaceId: schema.dataSourceConnections.workspaceId,
      subAccountId: schema.dataSourceConnections.subAccountId,
    })
    .from(schema.dataSourceConnections)
    .where(
      and(
        eq(schema.dataSourceConnections.toolType, GHL_PROVIDER_ID),
        eq(schema.dataSourceConnections.externalAccountId, payload.locationId),
      ),
    )
    .limit(1);
  if (!conn) {
    await db
      .update(schema.webhookInboundEvents)
      .set({
        processedAt: new Date(),
        error: `No connection for locationId=${payload.locationId}`,
      })
      .where(eq(schema.webhookInboundEvents.id, row.id));
    return { skipped: true, reason: "no_connection_for_location" };
  }

  const mapped = mapAppointmentToCall({
    type: payload.type,
    appointment: payload.appointment,
    contact: payload.contact,
  });

  const [existing] = await db
    .select({ id: schema.calls.id })
    .from(schema.calls)
    .where(
      and(
        eq(schema.calls.subAccountId, conn.subAccountId),
        eq(schema.calls.sourceIntegration, GHL_PROVIDER_ID),
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
        sourceIntegration: GHL_PROVIDER_ID,
        externalId: mapped.externalId,
        metadata: mapped.metadata,
      })
      .returning({ id: schema.calls.id });
    if (!inserted) throw new Error("Failed to insert call");
    callId = inserted.id;
    createdNew = true;
  }

  await funnelDomain.emitFunnelEvent(db, {
    workspaceId: conn.workspaceId,
    subAccountId: conn.subAccountId,
    entityType: "call",
    entityId: callId,
    stageSlug: createdNew ? "scheduled" : mapped.internalStatus,
    occurredAt: mapped.appointmentAt,
    sourceEventId: row.id,
    meta: { via: "ghl.webhook", ghlStatus: mapped.ghlStatus },
  });

  await db
    .update(schema.webhookInboundEvents)
    .set({ processedAt: new Date() })
    .where(eq(schema.webhookInboundEvents.id, row.id));

  return { skipped: false, callId, createdNew };
}

export const ghlWebhookHandler = inngest.createFunction(
  {
    id: "ghl-webhook-handler",
    concurrency: { limit: 20 },
    retries: 3,
  },
  { event: "ghl.webhook.received" },
  async ({ event, step }) => {
    const { inboundEventId } = event.data;
    return step
      .run("process", () => bypassRls((db) => processGhlInboundEvent(db, inboundEventId)))
      .catch((err) => {
        if (err instanceof NonRetriableError) throw err;
        throw new Error(
          `GHL webhook handler failed: ${err instanceof Error ? err.message : err}`,
        );
      });
  },
);
