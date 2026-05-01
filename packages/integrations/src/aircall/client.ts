// Aircall REST client + health-check helper. API-key auth — there's no
// OAuth flow, no refresh logic. Per-connection api_id and api_token are
// stored encrypted in data_source_connections.config (jsonb).

import { AIRCALL_API_BASE } from "./events";

export type AircallCredentials = {
  apiId: string;
  apiToken: string;
};

function authHeader({ apiId, apiToken }: AircallCredentials): string {
  // Aircall uses HTTP Basic with api_id:api_token.
  const b64 = Buffer.from(`${apiId}:${apiToken}`).toString("base64");
  return `Basic ${b64}`;
}

export async function aircallPing(creds: AircallCredentials): Promise<boolean> {
  try {
    const res = await fetch(`${AIRCALL_API_BASE}/ping`, {
      headers: { Authorization: authHeader(creds), Accept: "application/json" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export type AircallClient = {
  get: <T>(path: string, query?: Record<string, string>) => Promise<T>;
};

export function createAircallClient(creds: AircallCredentials): AircallClient {
  async function get<T>(path: string, query?: Record<string, string>): Promise<T> {
    const url = new URL(path, `${AIRCALL_API_BASE}/`);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await fetch(url, {
      headers: { Authorization: authHeader(creds), Accept: "application/json" },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Aircall ${path} failed (${res.status}): ${text}`);
    }
    return (await res.json()) as T;
  }
  return { get };
}
