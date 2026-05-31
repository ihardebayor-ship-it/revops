// Test-only endpoint: synchronously runs the hold-release sweep so dev
// flows don't have to wait for the hourly cron. Requires explicit enablement
// plus platform-superadmin access.

import { bypassRls } from "@revops/db/client";
import { commissions as commissionsDomain } from "@revops/domain";
import { requireTestEndpointAccess } from "../_guard";

export async function POST() {
  const access = await requireTestEndpointAccess();
  if (access instanceof Response) return access;

  const released = await bypassRls((db) => commissionsDomain.releaseAvailableEntries(db));
  return Response.json({ ok: true, released });
}
