import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "@revops/db/client";
import { getServerEnv } from "@revops/config/env";
import {
  bootstrapWorkspaceForUser,
  claimPendingInvitation,
} from "@revops/domain/onboarding";

function buildAuth() {
  const env = getServerEnv();
  const db = getDb();

  // Build the trusted-origins list. Better Auth rejects requests whose
  // Origin header isn't in this list with "Invalid origin". On Vercel,
  // deploys land at unpredictable preview URLs (vercel.app + branch +
  // production aliases) and the configured BETTER_AUTH_URL might not
  // match — so we read every Vercel-injected URL var and treat them
  // all as trusted. APP_URL covers a custom domain.
  const trustedOrigins = new Set<string>([env.BETTER_AUTH_URL, "http://localhost:3000"]);
  if (env.APP_URL) trustedOrigins.add(env.APP_URL);
  for (const key of [
    "VERCEL_URL", // current deployment, e.g. revops-abc123.vercel.app
    "VERCEL_BRANCH_URL", // branch alias
    "VERCEL_PROJECT_PRODUCTION_URL", // canonical prod alias
  ] as const) {
    const v = process.env[key];
    if (v) trustedOrigins.add(`https://${v}`);
  }

  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg" }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: Array.from(trustedOrigins),
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
              // Invited users join the inviting workspace; only fresh
              // sign-ups bootstrap a new workspace.
              const claimed = await claimPendingInvitation({
                userId: user.id,
                email: user.email,
              });
              if (claimed) return;
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
