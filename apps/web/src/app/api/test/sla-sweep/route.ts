// Test-only manual trigger for the speed-to-lead SLA sweep. The Inngest
// cron fires every minute in production; this endpoint exists for the
// dev demo flow where Inngest CLI isn't running.
//
// Refuses outside development.

import { headers } from "next/headers";
import { getAuth } from "@revops/auth/server";
import { bypassRls } from "@revops/db/client";
import { optins as optinsDomain } from "@revops/domain";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return new Response("Disabled", { status: 404 });
  }
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const result = await bypassRls((db) => optinsDomain.runSpeedToLeadSweep(db));
  return Response.json(result);
}
