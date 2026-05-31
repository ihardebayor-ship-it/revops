import { sql } from "drizzle-orm";
import { getServerEnv } from "@revops/config/env";
import { getDb } from "@revops/db/client";

export const runtime = "nodejs";

export async function GET() {
  const startedAt = Date.now();
  try {
    const env = getServerEnv();
    await getDb().execute(sql`select 1`);

    return Response.json({
      ok: true,
      checks: {
        env: "ok",
        db: "ok",
        inngest: env.INNGEST_EVENT_KEY && env.INNGEST_SIGNING_KEY ? "configured" : "missing",
      },
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "health check failed",
        durationMs: Date.now() - startedAt,
      },
      { status: 503 },
    );
  }
}
