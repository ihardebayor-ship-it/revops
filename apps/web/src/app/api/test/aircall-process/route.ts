// Dev-only synchronous Aircall handler runner.
import { headers } from "next/headers";
import { getAuth } from "@revops/auth/server";
import { bypassRls } from "@revops/db/client";
import { processAircallInboundEvent } from "@revops/jobs";

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return new Response("Disabled", { status: 404 });
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json()) as { inboundEventId?: string };
  if (!body.inboundEventId) return new Response("inboundEventId required", { status: 400 });

  const result = await bypassRls((db) => processAircallInboundEvent(db, body.inboundEventId!));
  return Response.json({ ok: true, result });
}
