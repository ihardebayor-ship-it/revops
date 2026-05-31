import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { getAuth } from "@revops/auth/server";
import { bypassRls, schema } from "@revops/db/client";

export type TestEndpointSession = {
  userId: string;
};

export async function requireTestEndpointAccess(): Promise<TestEndpointSession | Response> {
  if (process.env.ENABLE_TEST_ENDPOINTS !== "true") {
    return new Response("Disabled", { status: 404 });
  }

  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const isSuperadmin = await bypassRls(async (db) => {
    const [platformUser] = await db
      .select({ id: schema.platformUsers.id })
      .from(schema.platformUsers)
      .where(
        and(
          eq(schema.platformUsers.userId, session.user.id),
          eq(schema.platformUsers.isActive, true),
        ),
      )
      .limit(1);
    return Boolean(platformUser);
  });

  if (!isSuperadmin) return new Response("Forbidden", { status: 403 });

  return { userId: session.user.id };
}
