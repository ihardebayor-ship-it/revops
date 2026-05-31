const REQUIRED_PRODUCTION_VARS = [
  "APP_URL",
  "DATABASE_URL",
  "DATABASE_MIGRATION_URL",
  "REVOPS_APP_DB_PASSWORD",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "TOKEN_ENCRYPTION_KEY",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GHL_WEBHOOK_SECRET",
  "AIRCALL_WEBHOOK_TOKEN",
  "FATHOM_WEBHOOK_SECRET",
] as const;

export function getProductionEnvErrors(env: NodeJS.ProcessEnv = process.env): string[] {
  const errors: string[] = [];

  for (const name of REQUIRED_PRODUCTION_VARS) {
    if (!env[name] || env[name] === "") {
      errors.push(`${name} is required in production`);
    }
  }

  if (env.ENABLE_TEST_ENDPOINTS === "true") {
    errors.push("ENABLE_TEST_ENDPOINTS must be false in production");
  }

  if ((env.BETTER_AUTH_SECRET?.length ?? 0) < 32) {
    errors.push("BETTER_AUTH_SECRET must be at least 32 characters");
  }

  if ((env.TOKEN_ENCRYPTION_KEY?.length ?? 0) < 64) {
    errors.push("TOKEN_ENCRYPTION_KEY must be 64 hex characters");
  }

  return errors;
}

export function assertProductionEnv(env: NodeJS.ProcessEnv = process.env): void {
  const errors = getProductionEnvErrors(env);
  if (errors.length > 0) {
    throw new Error(`Invalid production environment:\n${errors.map((e) => `- ${e}`).join("\n")}`);
  }
}
