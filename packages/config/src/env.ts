import { z } from "zod";

const requiredInProd = (schema: z.ZodString) =>
  z.string().refine(
    (val) => {
      if (process.env.NODE_ENV === "production") {
        return schema.safeParse(val).success;
      }
      return true;
    },
    { message: "Required in production" },
  );

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 chars"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),

  INNGEST_EVENT_KEY: requiredInProd(z.string().min(1)).optional(),
  INNGEST_SIGNING_KEY: requiredInProd(z.string().min(1)).optional(),

  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  PUSHER_APP_ID: z.string().optional(),
  PUSHER_KEY: z.string().optional(),
  PUSHER_SECRET: z.string().optional(),
  PUSHER_CLUSTER: z.string().default("us3"),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().default("onboarding@resend.dev"),

  SENTRY_DSN: z.string().url().optional(),

  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_HOST: z.string().url().default("https://cloud.langfuse.com"),

  AXIOM_TOKEN: z.string().optional(),
  AXIOM_DATASET: z.string().default("revops-pro"),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default("revops-pro"),
  R2_PUBLIC_URL: z.string().url().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  TOKEN_ENCRYPTION_KEY: z
    .string()
    .min(64, "TOKEN_ENCRYPTION_KEY must be 64 hex chars (openssl rand -hex 32)"),
});

const clientEnvSchema = z.object({
  NEXT_PUBLIC_PUSHER_KEY: z.string().optional(),
  NEXT_PUBLIC_PUSHER_CLUSTER: z.string().default("us3"),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url().default("https://us.i.posthog.com"),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;

let cachedServerEnv: ServerEnv | null = null;
let cachedClientEnv: ClientEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("❌ Invalid server env:");
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid server environment configuration");
  }
  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

export function getClientEnv(): ClientEnv {
  if (cachedClientEnv) return cachedClientEnv;
  // Pull only NEXT_PUBLIC_* vars to avoid leaking secrets into client bundles.
  const publicEnv: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("NEXT_PUBLIC_")) {
      publicEnv[key] = value;
    }
  }
  const parsed = clientEnvSchema.safeParse(publicEnv);
  if (!parsed.success) {
    throw new Error("Invalid client environment configuration");
  }
  cachedClientEnv = parsed.data;
  return cachedClientEnv;
}
