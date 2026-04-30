// PostHog — product analytics + feature flags. Phase 0: no-op shim.

export type PosthogProps = Record<string, string | number | boolean | null | undefined>;

export interface PosthogClient {
  capture(event: string, props?: PosthogProps, distinctId?: string): void;
  identify(distinctId: string, props?: PosthogProps): void;
  isFeatureEnabled(flag: string, distinctId?: string): boolean;
}

const noopPosthog: PosthogClient = {
  capture: () => {},
  identify: () => {},
  isFeatureEnabled: () => false,
};

let cached: PosthogClient | null = null;

export function initPostHog(): PosthogClient {
  if (cached) return cached;
  cached = noopPosthog;
  return cached;
}

export const capture: PosthogClient["capture"] = (event, props, distinctId) =>
  initPostHog().capture(event, props, distinctId);
export const identify: PosthogClient["identify"] = (distinctId, props) =>
  initPostHog().identify(distinctId, props);
export const isFeatureEnabled: PosthogClient["isFeatureEnabled"] = (flag, distinctId) =>
  initPostHog().isFeatureEnabled(flag, distinctId);
