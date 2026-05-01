// Test-only endpoint: synchronously runs the commission engine for a
// given sale so the demo can verify entry production without an Inngest
// dev server. Refuses outside development.

import { headers } from "next/headers";
import { getAuth } from "@revops/auth/server";
import { bypassRls } from "@revops/db/client";
import { commissions as commissionsDomain } from "@revops/domain";

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new Response("Disabled", { status: 404 });
  }
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json()) as { saleId?: string };
  if (!body.saleId) return new Response("saleId required", { status: 400 });

  const result = await bypassRls((db) =>
    commissionsDomain.recomputeCommissionsForSale(db, {
      saleId: body.saleId!,
      triggeredBy: "test.endpoint",
    }),
  );
  return Response.json({ ok: true, result });
}
