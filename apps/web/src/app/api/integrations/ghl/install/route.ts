// GHL OAuth install: redirect the user to LeadConnector's chooselocation
// flow with our client_id, redirect_uri, scopes, and a base64 state that
// resolves the workspace + sub_account back in the callback.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { getAuth } from "@revops/auth/server";
import { can } from "@revops/auth/policy";
import { bypassRls, schema } from "@revops/db/client";
import { buildInstallUrl } from "@revops/integrations/ghl";

export async function GET(req: Request) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const workspaceSlug = url.searchParams.get("workspace");
  if (!workspaceSlug) return new Response("workspace param required", { status: 400 });

  const ctx = await bypassRls(async (db) => {
    const [ws] = await db
      .select({ id: schema.workspaces.id, slug: schema.workspaces.slug })
      .from(schema.workspaces)
      .where(and(eq(schema.workspaces.slug, workspaceSlug), isNull(schema.workspaces.deletedAt)))
      .limit(1);
    if (!ws) return null;
    const [member] = await db
      .select({
        accessRole: schema.memberships.accessRole,
        subAccountId: schema.memberships.subAccountId,
      })
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
    if (
      !can(
        {
          userId: session.user.id,
          workspaceId: ws.id,
          subAccountId: member.subAccountId,
          accessRole: member.accessRole,
          salesRoleSlugs: [],
          isSuperadmin: false,
        },
        "integration:connect",
      )
    ) {
      return null;
    }
    return { workspaceId: ws.id, subAccountId: member.subAccountId, slug: ws.slug };
  });
  if (!ctx) return new Response("Forbidden", { status: 403 });

  const clientId = process.env.GOHIGHLEVEL_CLIENT_ID;
  if (!clientId) return new Response("GHL not configured", { status: 501 });
  const stateSecret = process.env.BETTER_AUTH_SECRET;
  if (!stateSecret) return new Response("OAuth state signing not configured", { status: 501 });

  const redirectUri = new URL("/api/integrations/ghl/callback", url.origin).toString();
  const installUrl = buildInstallUrl({
    state: {
      workspaceId: ctx.workspaceId,
      subAccountId: ctx.subAccountId,
      returnUrl: `/${ctx.slug}/integrations`,
    },
    redirectUri,
    clientId,
    stateSecret,
  });
  redirect(installUrl);
}
