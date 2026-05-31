// Test-only manual trigger for the speed-to-lead SLA sweep. The Inngest
// cron fires every minute in production; this endpoint exists for the
// dev demo flow where Inngest CLI isn't running.
//
import { bypassRls } from "@revops/db/client";
import { optins as optinsDomain } from "@revops/domain";
import { requireTestEndpointAccess } from "../_guard";

export async function POST() {
  const access = await requireTestEndpointAccess();
  if (access instanceof Response) return access;

  const result = await bypassRls((db) => optinsDomain.runSpeedToLeadSweep(db));
  return Response.json(result);
}
