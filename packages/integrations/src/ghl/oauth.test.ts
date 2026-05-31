import { describe, expect, it } from "vitest";
import { buildInstallUrl, decodeInstallState, type GhlInstallState } from "./oauth";

const state: GhlInstallState = {
  workspaceId: "0f2be0d4-49e6-48d9-9d9d-7e13736688be",
  subAccountId: "f2f0ebaa-f0e1-4666-b7cd-ad5fd689c85c",
  returnUrl: "/acme/integrations",
};

describe("GHL OAuth install state", () => {
  it("round-trips a signed state payload", () => {
    const installUrl = buildInstallUrl({
      state,
      redirectUri: "https://app.example.com/api/integrations/ghl/callback",
      clientId: "client-1",
      stateSecret: "secret-1",
    });

    const stateParam = new URL(installUrl).searchParams.get("state");

    expect(stateParam).toBeTruthy();
    expect(decodeInstallState(stateParam!, "secret-1")).toEqual(state);
  });

  it("rejects state signed with another secret", () => {
    const stateParam = new URL(
      buildInstallUrl({
        state,
        redirectUri: "https://app.example.com/api/integrations/ghl/callback",
        clientId: "client-1",
        stateSecret: "secret-1",
      }),
    ).searchParams.get("state")!;

    expect(() => decodeInstallState(stateParam, "secret-2")).toThrow(/signature/i);
  });

  it("rejects payload tampering", () => {
    const stateParam = new URL(
      buildInstallUrl({
        state,
        redirectUri: "https://app.example.com/api/integrations/ghl/callback",
        clientId: "client-1",
        stateSecret: "secret-1",
      }),
    ).searchParams.get("state")!;

    const [, signature] = stateParam.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...state, workspaceId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }),
    ).toString("base64url");

    expect(() => decodeInstallState(`${tamperedPayload}.${signature}`, "secret-1")).toThrow(
      /signature/i,
    );
  });

  it("rejects malformed state", () => {
    expect(() => decodeInstallState("not-a-signed-state", "secret-1")).toThrow(/state/i);
  });
});
