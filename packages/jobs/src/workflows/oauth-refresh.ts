// Provider-agnostic OAuth token refresh.
//
// Acquires pg_advisory_xact_lock(hashtext('oauth:' || connection_id)) so
// two webhooks arriving simultaneously cannot double-refresh. The old app
// shipped with this race; we close it here on day one.
//
// Each provider registers its token-exchange function via registerRefresher
// in its client.ts module. This workflow is the single point that mutates
// stored tokens.

import { NonRetriableError } from "inngest";
import { eq, sql } from "drizzle-orm";
import { bypassRls, schema } from "@revops/db/client";
import { decryptToken, encryptToken, getRefresher } from "@revops/integrations/shared";
import { inngest } from "../client";

export const oauthRefresh = inngest.createFunction(
  {
    id: "oauth-refresh",
    concurrency: [
      { key: "event.data.connectionId", limit: 1 },
      { limit: 20 },
    ],
    retries: 2,
  },
  { event: "oauth.refresh.requested" },
  async ({ event, step }) => {
    const { connectionId, provider } = event.data;

    return step
      .run("refresh", () =>
        bypassRls((db) =>
          db.transaction(async (tx) => {
            await tx.execute(
              sql`SELECT pg_advisory_xact_lock(hashtext(${`oauth:${connectionId}`}))`,
            );

            const [conn] = await tx
              .select({
                id: schema.dataSourceConnections.id,
                refreshTokenEncrypted: schema.dataSourceConnections.refreshTokenEncrypted,
                expiresAt: schema.dataSourceConnections.expiresAt,
              })
              .from(schema.dataSourceConnections)
              .where(eq(schema.dataSourceConnections.id, connectionId))
              .limit(1);
            if (!conn) throw new NonRetriableError(`Connection ${connectionId} not found`);
            if (!conn.refreshTokenEncrypted) {
              throw new NonRetriableError(
                `Connection ${connectionId} has no refresh_token (API-key auth?)`,
              );
            }

            // Skip if a concurrent run beat us to it.
            if (conn.expiresAt && conn.expiresAt.getTime() - Date.now() > 5 * 60 * 1000) {
              return { connectionId, skipped: true, reason: "still_valid" };
            }

            await tx
              .update(schema.dataSourceConnections)
              .set({ refreshLockAcquiredAt: new Date() })
              .where(eq(schema.dataSourceConnections.id, connectionId));

            const refresher = getRefresher(provider);
            const refreshToken = decryptToken(conn.refreshTokenEncrypted);
            const result = await refresher({
              refreshToken,
              clientId: process.env[`${provider.toUpperCase()}_CLIENT_ID`] ?? "",
              clientSecret: process.env[`${provider.toUpperCase()}_CLIENT_SECRET`] ?? "",
            });

            const expiresAt = new Date(Date.now() + result.expiresInSeconds * 1000);
            await tx
              .update(schema.dataSourceConnections)
              .set({
                accessTokenEncrypted: encryptToken(result.accessToken),
                refreshTokenEncrypted: result.refreshToken
                  ? encryptToken(result.refreshToken)
                  : conn.refreshTokenEncrypted,
                expiresAt,
                scope: result.scope ?? null,
                healthStatus: "healthy",
                lastHealthCheckAt: new Date(),
                refreshLockAcquiredAt: null,
                updatedAt: new Date(),
              })
              .where(eq(schema.dataSourceConnections.id, connectionId));

            return { connectionId, skipped: false, expiresAt };
          }),
        ),
      )
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (err instanceof NonRetriableError) throw err;
        throw new Error(`OAuth refresh failed for ${connectionId}: ${msg}`);
      });
  },
);
