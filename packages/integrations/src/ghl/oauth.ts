// GHL OAuth dance.
//
// Install: redirect user to https://marketplace.gohighlevel.com/oauth/chooselocation
//   with our client_id, redirect_uri, scopes, state
// Callback: receive ?code=...&state=..., POST to token endpoint, get
//   { access_token, refresh_token, expires_in, locationId, userId, ... }
//
// State is signed JSON containing { subAccountId, returnUrl } so the
// callback can resolve the right tenant and route the user back without
// trusting caller-editable query params.

import { createHmac, timingSafeEqual } from "node:crypto";
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
  stateSecret: string;
}): string {
  const stateB64 = encodeInstallState(args.state, args.stateSecret);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    scope: GHL_OAUTH_SCOPES,
    state: stateB64,
  });
  return `${GHL_AUTH_BASE}?${params.toString()}`;
}

export function decodeInstallState(stateB64: string, stateSecret: string): GhlInstallState {
  const [payload, signature] = stateB64.split(".");
  if (!payload || !signature) throw new Error("Invalid OAuth state");
  const expected = signStatePayload(payload, stateSecret);
  const signatureBytes = Buffer.from(signature, "base64url");
  const expectedBytes = Buffer.from(expected, "base64url");
  if (
    signatureBytes.length !== expectedBytes.length ||
    !timingSafeEqual(signatureBytes, expectedBytes)
  ) {
    throw new Error("Invalid OAuth state signature");
  }
  const json = Buffer.from(payload, "base64url").toString("utf8");
  return JSON.parse(json) as GhlInstallState;
}

function encodeInstallState(state: GhlInstallState, stateSecret: string): string {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${payload}.${signStatePayload(payload, stateSecret)}`;
}

function signStatePayload(payload: string, stateSecret: string): string {
  return createHmac("sha256", stateSecret).update(payload).digest("base64url");
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
