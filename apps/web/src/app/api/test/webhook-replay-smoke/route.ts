// Test-only end-to-end smoke for inbound webhook operations. It creates a
// synthetic GHL inbound event for the selected workspace/sub-account, verifies
// the ops list sees it, processes it synchronously, resets it like a replay,
// and processes it again. Requires ENABLE_TEST_ENDPOINTS plus superadmin.

import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { bypassRls, schema } from "@revops/db/client";
import { GHL_PROVIDER_ID } from "@revops/integrations/ghl";
import { processGhlInboundEvent } from "@revops/jobs";
import { appRouter, createContext } from "@revops/trpc";
import { requireTestEndpointAccess } from "../_guard";

type ListedInboundEvent = {
  id: string;
  status: "pending" | "processed" | "failed";
};

export async function POST(req: Request) {
  const access = await requireTestEndpointAccess();
  if (access instanceof Response) return access;

  const workspaceId = req.headers.get("x-workspace-id");
  const subAccountId = req.headers.get("x-sub-account-id");
  if (!workspaceId || !subAccountId) {
    return new Response("x-workspace-id and x-sub-account-id required", { status: 400 });
  }

  const conn = await bypassRls(async (db) => {
    const [row] = await db
      .select({
        externalAccountId: schema.dataSourceConnections.externalAccountId,
      })
      .from(schema.dataSourceConnections)
      .where(
        and(
          eq(schema.dataSourceConnections.workspaceId, workspaceId),
          eq(schema.dataSourceConnections.subAccountId, subAccountId),
          eq(schema.dataSourceConnections.toolType, GHL_PROVIDER_ID),
          isNull(schema.dataSourceConnections.deletedAt),
          isNotNull(schema.dataSourceConnections.externalAccountId),
        ),
      )
      .limit(1);
    return row ?? null;
  });

  if (!conn?.externalAccountId) {
    return Response.json(
      {
        ok: false,
        reason: "no_ghl_connection",
        message: "Connect GHL for this sub-account before running the webhook replay smoke.",
      },
      { status: 409 },
    );
  }

  const caller = appRouter.createCaller(
    await createContext({ headers: req.headers, workspaceId, subAccountId }),
  );

  const appointmentId = `smoke-${randomUUID()}`;
  const externalId = `AppointmentCreate:${appointmentId}`;
  const appointmentAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const inboundEventId = await bypassRls(async (db) => {
    const [inserted] = await db
      .insert(schema.webhookInboundEvents)
      .values({
        source: GHL_PROVIDER_ID,
        providerAccountId: conn.externalAccountId!,
        externalId,
        payload: {
          type: "AppointmentCreate",
          locationId: conn.externalAccountId,
          appointment: {
            id: appointmentId,
            startTime: appointmentAt,
            appointmentStatus: "confirmed",
            contactId: `contact-${appointmentId}`,
          },
          contact: {
            id: `contact-${appointmentId}`,
            firstName: "Webhook",
            lastName: "Smoke",
            email: `webhook-smoke-${appointmentId}@example.test`,
            phone: "+15555550199",
          },
        },
        signatureVerified: false,
      })
      .returning({ id: schema.webhookInboundEvents.id });
    if (!inserted) throw new Error("Failed to create smoke inbound event");
    return inserted.id;
  });

  const pendingListed = await caller.webhooks.listInbound({
    source: GHL_PROVIDER_ID,
    status: "pending",
    limit: 100,
  });
  assertListed(pendingListed, inboundEventId, "pending");

  const firstProcess = await bypassRls((db) => processGhlInboundEvent(db, inboundEventId));

  const processedListed = await caller.webhooks.listInbound({
    source: GHL_PROVIDER_ID,
    status: "processed",
    limit: 100,
  });
  assertListed(processedListed, inboundEventId, "processed");

  await bypassRls(async (db) => {
    await db
      .update(schema.webhookInboundEvents)
      .set({ processedAt: null, error: null })
      .where(eq(schema.webhookInboundEvents.id, inboundEventId));
  });

  const replayPendingListed = await caller.webhooks.listInbound({
    source: GHL_PROVIDER_ID,
    status: "pending",
    limit: 100,
  });
  assertListed(replayPendingListed, inboundEventId, "pending");

  const replayProcess = await bypassRls((db) => processGhlInboundEvent(db, inboundEventId));
  if (replayProcess.skipped || replayProcess.createdNew) {
    throw new Error("Smoke replay did not reuse the existing GHL call");
  }

  const reprocessedListed = await caller.webhooks.listInbound({
    source: GHL_PROVIDER_ID,
    status: "processed",
    limit: 100,
  });
  assertListed(reprocessedListed, inboundEventId, "processed");

  return Response.json({
    ok: true,
    source: GHL_PROVIDER_ID,
    inboundEventId,
    externalId,
    firstProcess,
    replayProcess,
    checks: {
      pendingListed: true,
      processedListed: true,
      replayPendingListed: true,
      reprocessedListed: true,
    },
  });
}

function assertListed(
  rows: ListedInboundEvent[],
  inboundEventId: string,
  expectedStatus: ListedInboundEvent["status"],
) {
  const row = rows.find((event) => event.id === inboundEventId);
  if (!row) throw new Error(`Smoke inbound event not listed as ${expectedStatus}`);
  if (row.status !== expectedStatus) {
    throw new Error(`Smoke inbound event status was ${row.status}, expected ${expectedStatus}`);
  }
}
