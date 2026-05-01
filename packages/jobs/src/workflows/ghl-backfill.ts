// GHL one-shot backfill on connect. Pulls appointments for the past N
// days from the LeadConnector calendar API and converts each into a
// synthetic webhook_inbound_event so the existing handler picks them up.
//
// This way we don't have a second code path: the handler is the single
// place that turns GHL-shaped data into call rows.

import { NonRetriableError } from "inngest";
import { eq } from "drizzle-orm";
import { bypassRls, schema } from "@revops/db/client";
import { decryptToken } from "@revops/integrations/shared";
import { GHL_PROVIDER_ID, createGhlClient } from "@revops/integrations/ghl";
import { inngest } from "../client";

type BackfillAppointment = {
  id: string;
  startTime: string;
  endTime?: string;
  contactId?: string;
  appointmentStatus?: string;
  assignedUserId?: string;
};

type CalendarsListResponse = {
  calendars?: Array<{ id: string; name?: string }>;
};

type AppointmentsResponse = {
  events?: BackfillAppointment[];
  appointments?: BackfillAppointment[];
};

export const ghlBackfill = inngest.createFunction(
  {
    id: "ghl-backfill",
    concurrency: { key: "event.data.connectionId", limit: 1 },
    retries: 1,
  },
  { event: "ghl.backfill.requested" },
  async ({ event, step }) => {
    const { connectionId, sinceDays } = event.data;

    const conn = await step.run("load-connection", () =>
      bypassRls(async (db) => {
        const [row] = await db
          .select({
            id: schema.dataSourceConnections.id,
            workspaceId: schema.dataSourceConnections.workspaceId,
            subAccountId: schema.dataSourceConnections.subAccountId,
            accessTokenEncrypted: schema.dataSourceConnections.accessTokenEncrypted,
            externalAccountId: schema.dataSourceConnections.externalAccountId,
            toolType: schema.dataSourceConnections.toolType,
          })
          .from(schema.dataSourceConnections)
          .where(eq(schema.dataSourceConnections.id, connectionId))
          .limit(1);
        if (!row) throw new NonRetriableError(`Connection ${connectionId} not found`);
        if (row.toolType !== GHL_PROVIDER_ID) {
          throw new NonRetriableError(`Connection ${connectionId} is not GHL`);
        }
        return row;
      }),
    );

    if (!conn.accessTokenEncrypted) {
      throw new NonRetriableError("Connection has no access_token");
    }
    if (!conn.externalAccountId) {
      throw new NonRetriableError("Connection has no GHL location_id");
    }

    const accessToken = decryptToken(conn.accessTokenEncrypted);
    const client = createGhlClient(accessToken);

    const startMs = Date.now() - sinceDays * 24 * 3600 * 1000;
    const endMs = Date.now();

    // Fetch calendars in this location, then for each calendar fetch the
    // appointments in the window. The LeadConnector v1 endpoint shape:
    //   GET /calendars/?locationId={loc}
    //   GET /calendars/events?calendarId={cal}&startTime=...&endTime=...
    const calendars = await step.run("list-calendars", async () => {
      const data = await client.get<CalendarsListResponse>("/calendars/", {
        locationId: conn.externalAccountId!,
      });
      return data.calendars ?? [];
    });

    let synthesized = 0;
    for (const cal of calendars) {
      const events = await step.run(`list-events:${cal.id}`, async () => {
        try {
          const data = await client.get<AppointmentsResponse>("/calendars/events", {
            calendarId: cal.id,
            locationId: conn.externalAccountId!,
            startTime: String(startMs),
            endTime: String(endMs),
          });
          return data.events ?? data.appointments ?? [];
        } catch {
          // A single calendar failing shouldn't kill the whole backfill.
          return [] as BackfillAppointment[];
        }
      });

      for (const apt of events) {
        if (!apt.id || !apt.startTime) continue;
        const externalId = `Backfill:${apt.id}`;
        const inboundId = await bypassRls(async (db) => {
          const inserted = await db
            .insert(schema.webhookInboundEvents)
            .values({
              source: GHL_PROVIDER_ID,
              externalId,
              payload: {
                type: "AppointmentCreate",
                locationId: conn.externalAccountId,
                appointment: apt,
              } as Record<string, unknown>,
              signatureVerified: false,
            })
            .onConflictDoNothing({
              target: [
                schema.webhookInboundEvents.source,
                schema.webhookInboundEvents.externalId,
              ],
            })
            .returning({ id: schema.webhookInboundEvents.id });
          if (inserted.length > 0) return inserted[0]!.id;
          const [existing] = await db
            .select({ id: schema.webhookInboundEvents.id })
            .from(schema.webhookInboundEvents)
            .where(eq(schema.webhookInboundEvents.externalId, externalId))
            .limit(1);
          return existing?.id ?? null;
        });
        if (!inboundId) continue;
        await inngest.send({
          name: "ghl.webhook.received",
          data: { inboundEventId: inboundId },
        });
        synthesized++;
      }
    }

    return { connectionId, synthesized, calendars: calendars.length };
  },
);
