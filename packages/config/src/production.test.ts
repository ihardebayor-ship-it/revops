import { describe, expect, it } from "vitest";
import { getProductionEnvErrors } from "./production";

const validProdEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  APP_URL: "https://app.example.test",
  DATABASE_URL: "postgres://runtime:secret@example.test:5432/app",
  DATABASE_MIGRATION_URL: "postgres://owner:secret@example.test:5432/app",
  REVOPS_APP_DB_PASSWORD: "0123456789abcdef",
  BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  BETTER_AUTH_URL: "https://app.example.test",
  TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  INNGEST_EVENT_KEY: "event-key",
  INNGEST_SIGNING_KEY: "signing-key",
  ANTHROPIC_API_KEY: "anthropic-key",
  OPENAI_API_KEY: "openai-key",
  GHL_WEBHOOK_SECRET: "ghl-secret",
  AIRCALL_WEBHOOK_TOKEN: "aircall-token",
  FATHOM_WEBHOOK_SECRET: "fathom-secret",
  ENABLE_TEST_ENDPOINTS: "false",
};

describe("production env contract", () => {
  it("accepts the complete production contract", () => {
    expect(getProductionEnvErrors(validProdEnv)).toEqual([]);
  });

  it("rejects enabled test endpoints", () => {
    expect(getProductionEnvErrors({ ...validProdEnv, ENABLE_TEST_ENDPOINTS: "true" })).toContain(
      "ENABLE_TEST_ENDPOINTS must be false in production",
    );
  });

  it("requires webhook and agent secrets", () => {
    const errors = getProductionEnvErrors({
      ...validProdEnv,
      GHL_WEBHOOK_SECRET: "",
      AIRCALL_WEBHOOK_TOKEN: "",
      FATHOM_WEBHOOK_SECRET: "",
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
    });

    expect(errors).toContain("GHL_WEBHOOK_SECRET is required in production");
    expect(errors).toContain("AIRCALL_WEBHOOK_TOKEN is required in production");
    expect(errors).toContain("FATHOM_WEBHOOK_SECRET is required in production");
    expect(errors).toContain("ANTHROPIC_API_KEY is required in production");
    expect(errors).toContain("OPENAI_API_KEY is required in production");
  });
});
