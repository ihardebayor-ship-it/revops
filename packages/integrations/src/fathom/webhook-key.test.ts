import { describe, expect, it } from "vitest";
import { signFathomWebhookScope, verifyFathomWebhookScope } from "./webhook-key";

describe("Fathom webhook scope key", () => {
  it("round-trips a signed sub-account scope", () => {
    const scope = { subAccountId: "f2f0ebaa-f0e1-4666-b7cd-ad5fd689c85c" };
    const key = signFathomWebhookScope(scope, "secret-1");

    expect(verifyFathomWebhookScope(key, "secret-1")).toEqual(scope);
  });

  it("round-trips a signed workspace scope", () => {
    const scope = { workspaceId: "0f2be0d4-49e6-48d9-9d9d-7e13736688be" };
    const key = signFathomWebhookScope(scope, "secret-1");

    expect(verifyFathomWebhookScope(key, "secret-1")).toEqual(scope);
  });

  it("rejects keys signed with another secret", () => {
    const key = signFathomWebhookScope({ subAccountId: "sub-1" }, "secret-1");

    expect(verifyFathomWebhookScope(key, "secret-2")).toBeNull();
  });

  it("rejects payload tampering", () => {
    const key = signFathomWebhookScope({ subAccountId: "sub-1" }, "secret-1");
    const [, signature] = key.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ subAccountId: "sub-2", v: 1 })).toString(
      "base64url",
    );

    expect(verifyFathomWebhookScope(`${tamperedPayload}.${signature}`, "secret-1")).toBeNull();
  });

  it("rejects malformed keys", () => {
    expect(verifyFathomWebhookScope("not-a-signed-key", "secret-1")).toBeNull();
  });
});
