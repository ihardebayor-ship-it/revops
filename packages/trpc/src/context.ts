import { eq, and, isNull } from "drizzle-orm";
import { getAuth } from "@revops/auth/server";
import { type AuthContext } from "@revops/auth/policy";
import { getDb, bypassRls, type Db } from "@revops/db/client";
import { memberships, platformUsers } from "@revops/db/schema";

export type CreateContextOptions = {
  headers: Headers;
  workspaceId?: string | null;
  subAccountId?: string | null;
};

export type Context = {
  db: Db;
  headers: Headers;
  user: AuthContext | null;
};

/**
 * Build a tRPC context. The `user` field is populated from Better Auth's
 * session, then enriched with workspace + access-role from a privileged
 * membership lookup (RLS prevents the runtime role from reading membership
 * for the user-being-authenticated until session settings are placed, so
 * we use bypassRls for this initial resolution only).
 *
 * Sales-role resolution lands in Phase 1; for now `salesRoleSlugs` is empty.
 * The actual tx-scoped db swap happens in the authed-procedure middleware
 * via `withTenant`.
 */
export async function createContext({
  headers,
  workspaceId = null,
  subAccountId = null,
}: CreateContextOptions): Promise<Context> {
  const auth = getAuth();
  const db = getDb();
  const session = await auth.api.getSession({ headers });

  if (!session?.user) {
    return { db, headers, user: null };
  }

  const userId = session.user.id;

  const enriched = await bypassRls(async (privileged) => {
    const platformRow = await privileged
      .select({ id: platformUsers.id })
      .from(platformUsers)
      .where(and(eq(platformUsers.userId, userId), eq(platformUsers.isActive, true)))
      .limit(1);
    const isSuperadmin = platformRow.length > 0;

    if (!workspaceId) {
      return {
        userId,
        workspaceId: null,
        subAccountId: null,
        accessRole: null,
        salesRoleSlugs: [],
        isSuperadmin,
      } satisfies AuthContext;
    }

    const member = await privileged
      .select({
        accessRole: memberships.accessRole,
        subAccountId: memberships.subAccountId,
      })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.workspaceId, workspaceId),
          isNull(memberships.deletedAt),
        ),
      )
      .limit(1);

    if (member.length === 0 && !isSuperadmin) {
      return {
        userId,
        workspaceId: null,
        subAccountId: null,
        accessRole: null,
        salesRoleSlugs: [],
        isSuperadmin,
      } satisfies AuthContext;
    }

    return {
      userId,
      workspaceId,
      subAccountId: subAccountId ?? member[0]?.subAccountId ?? null,
      accessRole: member[0]?.accessRole ?? null,
      salesRoleSlugs: [],
      isSuperadmin,
    } satisfies AuthContext;
  });

  return { db, headers, user: enriched };
}
