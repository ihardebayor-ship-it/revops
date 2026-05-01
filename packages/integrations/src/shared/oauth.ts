// Shared OAuth helpers: a provider-agnostic token-refresh contract that
// the M5.0 oauth-refresh Inngest workflow consumes. Each provider's
// client.ts exports its own refresher conforming to this shape.

export type RefreshArgs = {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
};

export type RefreshResult = {
  accessToken: string;
  refreshToken?: string; // some providers rotate, some don't
  expiresInSeconds: number;
  scope?: string;
};

export type ProviderTokenRefresher = (args: RefreshArgs) => Promise<RefreshResult>;

const refreshers = new Map<string, ProviderTokenRefresher>();

export function registerRefresher(provider: string, refresher: ProviderTokenRefresher): void {
  refreshers.set(provider, refresher);
}

export function getRefresher(provider: string): ProviderTokenRefresher {
  const r = refreshers.get(provider);
  if (!r) throw new Error(`No OAuth refresher registered for provider "${provider}"`);
  return r;
}
