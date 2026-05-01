// Aircall connect: take api_id + api_token + aircall user.id, ping for
// health, encrypt + persist to data_source_connections. Body shape:
//   { workspaceSlug, apiId, apiToken, aircallUserId, label? }

import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { getAuth } from "@revops/auth/server";
import { bypassRls, schema } from "@revops/db/client";
import { encryptToken } from "@revops/integrations/shared";
import { AIRCALL_PROVIDER_ID, aircallPing } from "@revops/integrations/aircall";

export async function POST(req: Request) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json()) as {
    workspaceSlug?: string;
    apiId?: string;
    apiToken?: string;
    aircallUserId?: string;
    label?: string;
  };
  if (!body.workspaceSlug || !body.apiId || !body.apiToken || !body.aircallUserId) {
    return new Response(
      "workspaceSlug, apiId, apiToken, aircallUserId required",
      { status: 400 },
    );
  }

  const ctx = await bypassRls(async (db) => {
    const [ws] = await db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(
        and(
          eq(schema.workspaces.slug, body.workspaceSlug!),
          isNull(schema.workspaces.deletedAt),
        ),
      )
      .limit(1);
    if (!ws) return null;
    const [member] = await db
      .select({ subAccountId: schema.memberships.subAccountId })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.userId, session.user.id),
          eq(schema.memberships.workspaceId, ws.id),
          isNull(schema.memberships.deletedAt),
        ),
      )
      .limit(1);
    if (!member?.subAccountId) return null;
    return { workspaceId: ws.id, subAccountId: member.subAccountId };
  });
  if (!ctx) return new Response("Forbidden", { status: 403 });

  const ok = await aircallPing({ apiId: body.apiId, apiToken: body.apiToken });
  if (!ok) return new Response("Aircall ping failed — check credentials", { status: 400 });

  const connectionId = await bypassRls(async (db) => {
    let [ds] = await db
      .select({ id: schema.dataSources.id })
      .from(schema.dataSources)
      .where(
        and(
          eq(schema.dataSources.subAccountId, ctx.subAccountId),
          eq(schema.dataSources.kind, "calls"),
        ),
      )
      .limit(1);
    if (!ds) {
      const [inserted] = await db
        .insert(schema.dataSources)
        .values({
          workspaceId: ctx.workspaceId,
          subAccountId: ctx.subAccountId,
          kind: "calls",
          label: "Aircall",
          createdBy: session.user.id,
        })
        .returning({ id: schema.dataSources.id });
      if (!inserted) throw new Error("Failed to create data_source");
      ds = inserted;
    }

    // Upsert connection by (toolType, externalAccountId).
    const [existing] = await db
      .select({ id: schema.dataSourceConnections.id })
      .from(schema.dataSourceConnections)
      .where(
        and(
          eq(schema.dataSourceConnections.toolType, AIRCALL_PROVIDER_ID),
          eq(schema.dataSourceConnections.externalAccountId, body.aircallUserId!),
        ),
      )
      .limit(1);
    if (existing) {
      await db
        .update(schema.dataSourceConnections)
        .set({
          accessTokenEncrypted: encryptToken(body.apiToken!),
          config: { apiIdEncrypted: encryptToken(body.apiId!) },
          healthStatus: "healthy",
          lastHealthCheckAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.dataSourceConnections.id, existing.id));
      return existing.id;
    }

    const [conn] = await db
      .insert(schema.dataSourceConnections)
      .values({
        workspaceId: ctx.workspaceId,
        subAccountId: ctx.subAccountId,
        dataSourceId: ds.id,
        toolType: AIRCALL_PROVIDER_ID,
        label: body.label ?? "Aircall",
        accessTokenEncrypted: encryptToken(body.apiToken!),
        config: { apiIdEncrypted: encryptToken(body.apiId!) },
        externalAccountId: body.aircallUserId,
        healthStatus: "healthy",
        lastHealthCheckAt: new Date(),
        createdBy: session.user.id,
      })
      .returning({ id: schema.dataSourceConnections.id });
    if (!conn) throw new Error("Failed to create connection");
    return conn.id;
  });

  return Response.json({ ok: true, connectionId });
}
