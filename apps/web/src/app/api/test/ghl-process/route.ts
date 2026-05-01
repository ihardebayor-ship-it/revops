// Dev-only: synchronously runs the GHL inbound event handler so the M5
// demo doesn't depend on a live Inngest dev server. Refuses outside dev.

import { headers } from "next/headers";
import { getAuth } from "@revops/auth/server";
import { bypassRls } from "@revops/db/client";
import { processGhlInboundEvent } from "@revops/jobs";

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new Response("Disabled", { status: 404 });
  }
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json()) as { inboundEventId?: string };
  if (!body.inboundEventId) return new Response("inboundEventId required", { status: 400 });

  const result = await bypassRls((db) => processGhlInboundEvent(db, body.inboundEventId!));
  return Response.json({ ok: true, result });
}
