// Aircall webhook authentication. Aircall uses a shared "token" — the same
// one configured in the dashboard is sent in payload.token (NOT a header).
// Validation is therefore a constant-time string compare. Header-based
// HMAC is not available in the public webhook product as of writing.

import { timingSafeEqual } from "node:crypto";

export function verifyAircallToken(payloadToken: string | undefined): boolean {
  const expected = process.env.AIRCALL_WEBHOOK_TOKEN;
  if (!expected) return false;
  if (!payloadToken) return false;
  if (expected.length !== payloadToken.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(payloadToken));
  } catch {
    return false;
  }
}
