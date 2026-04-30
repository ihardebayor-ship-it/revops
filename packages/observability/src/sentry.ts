// Sentry — error reporting. Phase 0: lightweight no-op-fallback shim that
// matches Sentry's surface (`captureException`, `captureMessage`,
// `addBreadcrumb`). When SENTRY_DSN is set, swap the no-ops for the real
// SDK in Phase 1+.

export type SentryContext = Record<string, unknown>;

export interface SentryClient {
  captureException(err: unknown, context?: SentryContext): void;
  captureMessage(message: string, context?: SentryContext): void;
  addBreadcrumb(breadcrumb: { message: string; category?: string; data?: SentryContext }): void;
}

const noopSentry: SentryClient = {
  captureException: (err) => {
    // Always log to stderr so failures aren't lost when DSN is unset.
    console.error("[sentry:noop] captureException", err);
  },
  captureMessage: (message, context) => {
    console.warn("[sentry:noop] captureMessage", message, context);
  },
  addBreadcrumb: () => {},
};

let cached: SentryClient | null = null;

export function initSentry(): SentryClient {
  if (cached) return cached;
  // Real SDK init lives behind a dynamic import so the no-op path doesn't
  // pull `@sentry/nextjs` into bundles that don't need it.
  cached = noopSentry;
  return cached;
}

export const captureException: SentryClient["captureException"] = (err, context) =>
  initSentry().captureException(err, context);

export const captureMessage: SentryClient["captureMessage"] = (message, context) =>
  initSentry().captureMessage(message, context);

export const addBreadcrumb: SentryClient["addBreadcrumb"] = (breadcrumb) =>
  initSentry().addBreadcrumb(breadcrumb);
