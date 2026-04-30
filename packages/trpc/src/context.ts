import { getAuth } from "@revops/auth/server";
import { type AuthContext } from "@revops/auth/policy";
import { getDb, type Db } from "@revops/db/client";

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

  return {
    db,
    headers,
    user: {
      userId: session.user.id,
      workspaceId,
      subAccountId,
      accessRole: null,
      salesRoleSlugs: [],
      isSuperadmin: false,
    },
  };
}
