import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "@revops/db/client";
import { getServerEnv } from "@revops/config/env";
import { bootstrapWorkspaceForUser } from "@revops/domain/onboarding";

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
    databaseHooks: {
      user: {
        create: {
          // Runs after Better Auth's user-create transaction commits. We
          // bootstrap a workspace for every brand-new user. Failures here do
          // NOT roll back the user creation; failed bootstraps surface as
          // a "no workspace" state that the onboarding route handles by
          // re-running bootstrap.
          after: async (user) => {
            try {
              await bootstrapWorkspaceForUser({
                userId: user.id,
                email: user.email,
                displayName: user.name ?? null,
              });
            } catch (err) {
              console.error("Workspace bootstrap failed for user", user.id, err);
            }
          },
        },
      },
    },
  });
}

let cachedAuth: ReturnType<typeof buildAuth> | null = null;

export function getAuth(): ReturnType<typeof buildAuth> {
  if (!cachedAuth) cachedAuth = buildAuth();
  return cachedAuth;
}

export type Auth = ReturnType<typeof buildAuth>;
