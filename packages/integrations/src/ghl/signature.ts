// GHL webhook signature verification. LeadConnector signs requests with
// HMAC-SHA256 over the raw body using a per-app shared secret (env var
// GHL_WEBHOOK_SECRET). Header is `x-wh-signature` per the docs.

import { verifyHmacSignature } from "../shared/signature";

export function verifyGhlSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.GHL_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!header) return false;
  // GHL ships either bare hex or `sha256=...` prefixed.
  const prefix = header.startsWith("sha256=") ? "sha256=" : undefined;
  return verifyHmacSignature({
    payload: rawBody,
    signature: header,
    secret,
    algo: "sha256",
    prefix,
  });
}
