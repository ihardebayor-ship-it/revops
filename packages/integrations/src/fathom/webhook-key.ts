import { createHmac, timingSafeEqual } from "node:crypto";

export type FathomWebhookScope =
  | { workspaceId: string; subAccountId?: null }
  | { workspaceId?: null; subAccountId: string };

export function signFathomWebhookScope(scope: FathomWebhookScope, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ ...scope, v: 1 })).toString("base64url");
  return `${payload}.${signPayload(payload, secret)}`;
}

export function verifyFathomWebhookScope(key: string, secret: string): FathomWebhookScope | null {
  const [payload, signature] = key.split(".");
  if (!payload || !signature) return null;

  const expected = signPayload(payload, secret);
  const signatureBytes = Buffer.from(signature, "base64url");
  const expectedBytes = Buffer.from(expected, "base64url");
  if (
    signatureBytes.length !== expectedBytes.length ||
    !timingSafeEqual(signatureBytes, expectedBytes)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      v?: unknown;
      workspaceId?: unknown;
      subAccountId?: unknown;
    };
    if (parsed.v !== 1) return null;
    if (typeof parsed.subAccountId === "string" && parsed.subAccountId.length > 0) {
      return { subAccountId: parsed.subAccountId };
    }
    if (typeof parsed.workspaceId === "string" && parsed.workspaceId.length > 0) {
      return { workspaceId: parsed.workspaceId };
    }
    return null;
  } catch {
    return null;
  }
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
