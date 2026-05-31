// Dev-only: synchronously runs the GHL inbound event handler so the M5
// demo doesn't depend on a live Inngest dev server. Requires explicit
// enablement plus platform-superadmin access.

import { bypassRls } from "@revops/db/client";
import { processGhlInboundEvent } from "@revops/jobs";
import { requireTestEndpointAccess } from "../_guard";

export async function POST(req: Request) {
  const access = await requireTestEndpointAccess();
  if (access instanceof Response) return access;

  const body = (await req.json()) as { inboundEventId?: string };
  if (!body.inboundEventId) return new Response("inboundEventId required", { status: 400 });

  const result = await bypassRls((db) => processGhlInboundEvent(db, body.inboundEventId!));
  return Response.json({ ok: true, result });
}
