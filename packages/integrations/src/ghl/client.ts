// Thin REST client. Used by the backfill workflow + any future read paths.
// Refresh logic does NOT live here — it goes through the M5.0 oauth-refresh
// workflow with advisory lock. This client takes an already-decrypted
// access token from the caller.

import { registerRefresher } from "../shared/oauth";
import { refreshAccessToken } from "./oauth";

export const GHL_API_BASE = "https://services.leadconnectorhq.com";

export type GhlClient = {
  get: <T>(path: string, query?: Record<string, string>) => Promise<T>;
};

export function createGhlClient(accessToken: string): GhlClient {
  async function get<T>(path: string, query?: Record<string, string>): Promise<T> {
    const url = new URL(path, GHL_API_BASE);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: "2021-07-28",
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GHL ${path} failed (${res.status}): ${text}`);
    }
    return (await res.json()) as T;
  }
  return { get };
}

// Wire GHL into the shared OAuth refresh contract.
registerRefresher("gohighlevel", async (args) => {
  const result = await refreshAccessToken({
    refreshToken: args.refreshToken,
    clientId: args.clientId,
    clientSecret: args.clientSecret,
  });
  return {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresInSeconds: result.expiresIn,
    scope: result.scope,
  };
});
