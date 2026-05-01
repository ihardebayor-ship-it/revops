// Test-only endpoint: synchronously runs the hold-release sweep so dev
// flows don't have to wait for the hourly cron. Refuses outside development.

import { headers } from "next/headers";
import { getAuth } from "@revops/auth/server";
import { bypassRls } from "@revops/db/client";
import { commissions as commissionsDomain } from "@revops/domain";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return new Response("Disabled", { status: 404 });
  }
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const released = await bypassRls((db) => commissionsDomain.releaseAvailableEntries(db));
  return Response.json({ ok: true, released });
}
