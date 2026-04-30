// Workspace resolution helpers for server components. Reads the Better Auth
// session, looks up the workspace by slug (privileged via bypassRls because
// memberships is RLS'd to a workspace context we haven't established yet),
// validates membership, returns a TenantScope ready for `withTenant`.

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { getAuth } from "@revops/auth/server";
import { type AuthContext } from "@revops/auth/policy";
import { bypassRls, schema } from "@revops/db/client";

export type WorkspaceContext = {
  workspace: {
    id: string;
    name: string;
    slug: string;
    topologyPreset: string;
  };
  membership: {
    accessRole: AuthContext["accessRole"];
    subAccountId: string | null;
  };
  authCtx: AuthContext;
};

/**
 * Resolve the active workspace by slug for the authenticated user. Redirects
 * to /sign-in if there is no session, or / if the user has no membership in
 * the requested workspace. Cached per request (React.cache).
 */
export const resolveWorkspaceBySlug = cache(async (slug: string): Promise<WorkspaceContext> => {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  return bypassRls(async (db) => {
    const platformRow = await db
      .select({ id: schema.platformUsers.id })
      .from(schema.platformUsers)
      .where(
        and(
          eq(schema.platformUsers.userId, session.user.id),
          eq(schema.platformUsers.isActive, true),
        ),
      )
      .limit(1);
    const isSuperadmin = platformRow.length > 0;

    const ws = await db
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        slug: schema.workspaces.slug,
        topologyPreset: schema.workspaces.topologyPreset,
      })
      .from(schema.workspaces)
      .where(and(eq(schema.workspaces.slug, slug), isNull(schema.workspaces.deletedAt)))
      .limit(1);
    const workspace = ws[0];
    if (!workspace) {
      redirect("/");
    }

    const member = await db
      .select({
        accessRole: schema.memberships.accessRole,
        subAccountId: schema.memberships.subAccountId,
      })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.userId, session.user.id),
          eq(schema.memberships.workspaceId, workspace.id),
          isNull(schema.memberships.deletedAt),
        ),
      )
      .limit(1);
    const membership = member[0];
    if (!membership && !isSuperadmin) {
      redirect("/");
    }

    return {
      workspace,
      membership: {
        accessRole: membership?.accessRole ?? null,
        subAccountId: membership?.subAccountId ?? null,
      },
      authCtx: {
        userId: session.user.id,
        workspaceId: workspace.id,
        subAccountId: membership?.subAccountId ?? null,
        accessRole: membership?.accessRole ?? null,
        salesRoleSlugs: [],
        isSuperadmin,
      },
    };
  });
});
