import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { getServerEnv } from "@revops/config/env";
import * as schema from "./schema/index";

// ─── Pools ───────────────────────────────────────────────────────────────
// Two pools: revops_app (runtime, no BYPASSRLS) and the migration role
// (BYPASSRLS, used by bypassRls helper, drizzle-kit, seed scripts). Never
// reach for the migration pool from request-handling code unless you have
// a documented reason — bypassing RLS is a security decision.
let appPool: Sql | null = null;
let migrationPool: Sql | null = null;
let appDb: ReturnType<typeof drizzle<typeof schema>> | null = null;
let migrationDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

function makeAppPool(): Sql {
  const env = getServerEnv();
  return postgres(env.DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 30,
    prepare: false,
  });
}

function makeMigrationPool(): Sql {
  const env = getServerEnv();
  return postgres(env.DATABASE_MIGRATION_URL, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 30,
    prepare: false,
  });
}

export function getDb() {
  if (appDb) return appDb;
  if (!appPool) appPool = makeAppPool();
  appDb = drizzle(appPool, { schema, casing: "snake_case" });
  return appDb;
}

// Db accepts both the top-level pool-bound client and a transaction (the
// drizzle transaction type is structurally compatible for query methods
// but lacks `$client`). Domain helpers take Db so they can be called from
// within a withTenant transaction or directly off the pool.
export type Db = PostgresJsDatabase<typeof schema>;
export { schema };

// ─── Tenant scope ────────────────────────────────────────────────────────
// Shape `withTenant` requires. Structurally compatible with AuthContext from
// @revops/auth/policy — which intentionally avoids a circular import between
// the auth and db packages.
export type TenantScope = {
  userId: string;
  workspaceId: string | null;
  subAccountId: string | null;
  isSuperadmin: boolean;
};

/**
 * Run `fn` inside a Postgres transaction with `app.current_*` session
 * settings populated from `scope`. RLS policies on tenant tables read these
 * settings; outside `withTenant`, the same queries see zero rows.
 *
 * The session settings are transaction-local (third arg `true` to
 * set_config), so they auto-clear on commit/rollback. Safe under PgBouncer
 * pooling.
 *
 * Use this for every authenticated request path: tRPC procedures, Server
 * Actions, and Inngest tool steps.
 */
export async function withTenant<T>(
  scope: TenantScope,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${scope.userId}, true)`);
    await tx.execute(
      sql`SELECT set_config('app.current_workspace_id', ${scope.workspaceId ?? ""}, true)`,
    );
    await tx.execute(
      sql`SELECT set_config('app.current_sub_account_id', ${scope.subAccountId ?? ""}, true)`,
    );
    await tx.execute(
      sql`SELECT set_config('app.is_superadmin', ${scope.isSuperadmin ? "1" : "0"}, true)`,
    );
    return fn(tx as unknown as Db);
  });
}

/**
 * Run `fn` against the migration pool, which bypasses RLS at the role
 * level (the role has BYPASSRLS / is a superuser).
 *
 * Legitimate uses (grep should find <5 across the codebase):
 *  - workspace bootstrap on first sign-up (no membership exists yet)
 *  - superadmin operations (`/superadmin` routes)
 *  - eval runner workflows that span workspaces
 *  - membership lookups inside createContext that populate the AuthContext
 *
 * Never call this from a tenant-scoped path. RLS is the load-bearing
 * defense; bypassing it must be a deliberate, auditable decision.
 */
export async function bypassRls<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  if (!migrationPool) migrationPool = makeMigrationPool();
  if (!migrationDb) {
    migrationDb = drizzle(migrationPool, { schema, casing: "snake_case" });
  }
  return fn(migrationDb);
}
