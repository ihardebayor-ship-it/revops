// Fathom webhook signature verification. Fathom signs payloads with
// HMAC-SHA256 over the raw body using a shared secret stored as
// FATHOM_WEBHOOK_SECRET. Header is `x-fathom-signature` or
// `x-webhook-signature` per old-app fathom-recording-webhook lines 100-132.

import { verifyHmacSignature } from "../shared/signature";

export function verifyFathomSignature(
  rawBody: string,
  headers: { fathom: string | null; webhook: string | null },
): boolean {
  const secret = process.env.FATHOM_WEBHOOK_SECRET;
  if (!secret) return false;
  const sig = headers.fathom ?? headers.webhook;
  if (!sig) return false;
  // Strip optional `sha256=` or `whsec_` prefixes the way the old app did.
  let prefix: string | undefined;
  if (sig.startsWith("sha256=")) prefix = "sha256=";
  else if (sig.startsWith("whsec_")) prefix = "whsec_";
  return verifyHmacSignature({
    payload: rawBody,
    signature: sig,
    secret,
    algo: "sha256",
    prefix,
  });
}
