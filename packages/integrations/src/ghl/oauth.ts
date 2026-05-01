// GHL OAuth dance.
//
// Install: redirect user to https://marketplace.gohighlevel.com/oauth/chooselocation
//   with our client_id, redirect_uri, scopes, state
// Callback: receive ?code=...&state=..., POST to token endpoint, get
//   { access_token, refresh_token, expires_in, locationId, userId, ... }
//
// State is base64-encoded JSON containing { subAccountId, returnUrl }
// so the callback can resolve the right tenant and route the user back.

import { GHL_OAUTH_SCOPES } from "./events";

const GHL_AUTH_BASE = "https://marketplace.gohighlevel.com/oauth/chooselocation";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";

export type GhlInstallState = {
  subAccountId: string;
  workspaceId: string;
  returnUrl?: string;
};

export function buildInstallUrl(args: {
  state: GhlInstallState;
  redirectUri: string;
  clientId: string;
}): string {
  const stateB64 = Buffer.from(JSON.stringify(args.state)).toString("base64url");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    scope: GHL_OAUTH_SCOPES,
    state: stateB64,
  });
  return `${GHL_AUTH_BASE}?${params.toString()}`;
}

export function decodeInstallState(stateB64: string): GhlInstallState {
  const json = Buffer.from(stateB64, "base64url").toString("utf8");
  return JSON.parse(json) as GhlInstallState;
}

export type GhlTokenExchangeResult = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
  scope?: string;
  locationId?: string;
  userId?: string;
};

export async function exchangeCodeForTokens(args: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): Promise<GhlTokenExchangeResult> {
  const body = new URLSearchParams({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    user_type: "Location",
  });
  const res = await fetch(GHL_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL token exchange failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  return {
    accessToken: String(json.access_token),
    refreshToken: String(json.refresh_token),
    expiresIn: Number(json.expires_in),
    scope: json.scope ? String(json.scope) : undefined,
    locationId: json.locationId ? String(json.locationId) : undefined,
    userId: json.userId ? String(json.userId) : undefined,
  };
}

export async function refreshAccessToken(args: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<GhlTokenExchangeResult> {
  const body = new URLSearchParams({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
    user_type: "Location",
  });
  const res = await fetch(GHL_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL refresh failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  return {
    accessToken: String(json.access_token),
    refreshToken: String(json.refresh_token),
    expiresIn: Number(json.expires_in),
    scope: json.scope ? String(json.scope) : undefined,
  };
}
