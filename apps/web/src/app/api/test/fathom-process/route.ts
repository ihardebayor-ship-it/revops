// Dev-only synchronous Fathom handler runner.
import { bypassRls } from "@revops/db/client";
import { processFathomInboundEvent } from "@revops/jobs";
import { requireTestEndpointAccess } from "../_guard";

export async function POST(req: Request) {
  const access = await requireTestEndpointAccess();
  if (access instanceof Response) return access;

  const body = (await req.json()) as { inboundEventId?: string };
  if (!body.inboundEventId) return new Response("inboundEventId required", { status: 400 });

  const result = await bypassRls((db) => processFathomInboundEvent(db, body.inboundEventId!));
  return Response.json({ ok: true, result });
}
