// Test-only endpoint: synchronously runs the commission engine for a
// given sale so the demo can verify entry production without an Inngest
// dev server. Requires explicit enablement plus platform-superadmin access.

import { bypassRls } from "@revops/db/client";
import { commissions as commissionsDomain } from "@revops/domain";
import { requireTestEndpointAccess } from "../_guard";

export async function POST(req: Request) {
  const access = await requireTestEndpointAccess();
  if (access instanceof Response) return access;

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
