import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "@revops/db/client";
import { getServerEnv } from "@revops/config/env";

function buildAuth() {
  const env = getServerEnv();
  const db = getDb();
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg" }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
  });
}

let cachedAuth: ReturnType<typeof buildAuth> | null = null;

export function getAuth(): ReturnType<typeof buildAuth> {
  if (!cachedAuth) cachedAuth = buildAuth();
  return cachedAuth;
}

export type Auth = ReturnType<typeof buildAuth>;
