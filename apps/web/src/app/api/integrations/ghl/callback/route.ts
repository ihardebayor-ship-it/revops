// GHL OAuth callback. LeadConnector redirects here with ?code=...&state=...
// We exchange the code for tokens, encrypt them, persist a
// data_source_connection row, and redirect the user back to /integrations.

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getAuth } from "@revops/auth/server";
import { bypassRls, schema } from "@revops/db/client";
import { encryptToken } from "@revops/integrations/shared";
import {
  GHL_PROVIDER_ID,
  decodeInstallState,
  exchangeCodeForTokens,
} from "@revops/integrations/ghl";
import { inngest } from "@revops/jobs";

export async function GET(req: Request) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateB64 = url.searchParams.get("state");
  if (!code || !stateB64) return new Response("code/state missing", { status: 400 });

  let state;
  try {
    state = decodeInstallState(stateB64);
  } catch {
    return new Response("Invalid state", { status: 400 });
  }

  const clientId = process.env.GOHIGHLEVEL_CLIENT_ID;
  const clientSecret = process.env.GOHIGHLEVEL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return new Response("GHL not configured", { status: 501 });

  const redirectUri = new URL("/api/integrations/ghl/callback", url.origin).toString();
  const tokens = await exchangeCodeForTokens({
    code,
    redirectUri,
    clientId,
    clientSecret,
  });

  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
  const connectionId = await bypassRls(async (db) => {
    // Ensure a data_sources row exists for this provider in this sub-account.
    let [ds] = await db
      .select({ id: schema.dataSources.id })
      .from(schema.dataSources)
      .where(
        and(
          eq(schema.dataSources.subAccountId, state.subAccountId),
          eq(schema.dataSources.kind, "appointments"),
        ),
      )
      .limit(1);
    if (!ds) {
      const [inserted] = await db
        .insert(schema.dataSources)
        .values({
          workspaceId: state.workspaceId,
          subAccountId: state.subAccountId,
          kind: "appointments",
          label: "GoHighLevel",
          createdBy: session.user.id,
        })
        .returning({ id: schema.dataSources.id });
      if (!inserted) throw new Error("Failed to create data_source");
      ds = inserted;
    }

    // Upsert the connection by (toolType, externalAccountId).
    if (tokens.locationId) {
      const [existing] = await db
        .select({ id: schema.dataSourceConnections.id })
        .from(schema.dataSourceConnections)
        .where(
          and(
            eq(schema.dataSourceConnections.toolType, GHL_PROVIDER_ID),
            eq(schema.dataSourceConnections.externalAccountId, tokens.locationId),
          ),
        )
        .limit(1);
      if (existing) {
        await db
          .update(schema.dataSourceConnections)
          .set({
            accessTokenEncrypted: encryptToken(tokens.accessToken),
            refreshTokenEncrypted: encryptToken(tokens.refreshToken),
            expiresAt,
            scope: tokens.scope ?? null,
            healthStatus: "healthy",
            lastHealthCheckAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.dataSourceConnections.id, existing.id));
        return existing.id;
      }
    }

    const [conn] = await db
      .insert(schema.dataSourceConnections)
      .values({
        workspaceId: state.workspaceId,
        subAccountId: state.subAccountId,
        dataSourceId: ds.id,
        toolType: GHL_PROVIDER_ID,
        label: "GoHighLevel",
        accessTokenEncrypted: encryptToken(tokens.accessToken),
        refreshTokenEncrypted: encryptToken(tokens.refreshToken),
        expiresAt,
        scope: tokens.scope ?? null,
        externalAccountId: tokens.locationId ?? null,
        healthStatus: "healthy",
        lastHealthCheckAt: new Date(),
        createdBy: session.user.id,
      })
      .returning({ id: schema.dataSourceConnections.id });
    if (!conn) throw new Error("Failed to create connection");
    return conn.id;
  });

  // Kick off a 90-day backfill in the background.
  await inngest.send({
    name: "ghl.backfill.requested",
    data: { connectionId, sinceDays: 90 },
  });

  redirect(state.returnUrl ?? "/");
}
