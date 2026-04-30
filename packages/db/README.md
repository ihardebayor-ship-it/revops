# @revops/db

Drizzle schema, migrations, and the typed Postgres client for RevOps Pro.

## Two-role security model

Every Postgres connection runs as one of two roles. The choice is foundational — never collapse them back into one URL.

| Role | URL env var | BYPASSRLS | Used by |
|---|---|---|---|
| `revops_app` | `DATABASE_URL` | **No** | Runtime app, every authenticated request, every Inngest tool step |
| `neondb_owner` (or equivalent superuser) | `DATABASE_MIGRATION_URL` | Yes | drizzle-kit, seed scripts, the `bypassRls()` helper, workspace bootstrap on first sign-up |

`revops_app` is created by [drizzle/0001_rls_policies.sql](drizzle/0001_rls_policies.sql) using the password in `REVOPS_APP_DB_PASSWORD`. After the migration runs, switch `DATABASE_URL` to use `revops_app:${REVOPS_APP_DB_PASSWORD}@…`.

### Why two roles

Postgres RLS policies are silently bypassed by superusers and by roles created with `BYPASSRLS`. If the runtime connects as a superuser, RLS is *off in practice* even with policies defined — every Phase-1 bug becomes a cross-tenant data leak. Splitting roles makes RLS load-bearing.

## Session-context model

RLS policies on tenant tables read three transaction-local Postgres settings:

- `app.current_user_id` — Better Auth user ID
- `app.current_workspace_id` — UUID of the workspace the request is scoped to
- `app.current_sub_account_id` — UUID (when set; sub-account scoping is layered in queries, not in RLS)
- `app.is_superadmin` — `'1'` or `'0'`; gates platform-only tables

These are set by the `withTenant(authCtx, fn)` helper in [src/client.ts](src/client.ts). The helper opens a Postgres transaction, calls `set_config(..., true)` (the `true` makes the setting transaction-local — auto-clears on commit/rollback, no leak risk under PgBouncer pooling), and runs the callback inside.

Three call sites:
1. **tRPC** — `authedProcedure` middleware wraps every authed procedure in `withTenant`.
2. **Server Actions** — call `withTenant(authCtx, async (db) => domain.x.y(db, args))` directly.
3. **Inngest tool steps** — `agent.turn` workflow constructs an `AuthContext` at `load-context` and wraps every `step.run("execute-tool", ...)` body in `withTenant`.

## bypassRls helper

For the rare cases that legitimately need to ignore RLS (workspace bootstrap on first sign-up, eval runner, superadmin operations), use `bypassRls(fn)` from [src/client.ts](src/client.ts). It opens a connection on `DATABASE_MIGRATION_URL` (the superuser pool) and runs the callback. Grep finds <5 call sites by design.

## Migrations

Hand-rolled migrations live alongside drizzle-kit-generated ones in [drizzle/](drizzle/). The migration runner ([src/migrate.ts](src/migrate.ts)) applies in this order:

1. `0000-extensions.sql` — `pgcrypto` and `vector` extensions
2. drizzle-kit-generated migrations (currently `0000_pink_skullbuster.sql`)
3. `0001-rls-helpers.sql` — `app_current_*` and `app_is_superadmin` PL/pgSQL helpers
4. `0001_rls_policies.sql` — creates `revops_app` role, enables RLS, adds `tenant_isolation` and `platform_admin` policies

`pnpm db:migrate` runs them all in sequence. It needs `DATABASE_MIGRATION_URL` and `REVOPS_APP_DB_PASSWORD` set; the password is injected as a session GUC (`SET revops.app_password`) before the role-creation SQL runs.

## Adding a new table

1. Add the schema file in [src/schema/](src/schema/) and re-export from [src/schema/index.ts](src/schema/index.ts).
2. `pnpm db:generate` — drizzle-kit produces a new SQL migration in `drizzle/`.
3. **If the table is tenant-scoped, add it to the appropriate array in `0001_rls_policies.sql`** — either `direct_tables` (carries `workspace_id`) or `via_parent_specs` (child of a workspace-scoped parent). Re-run the migration to create the policy.
4. `pnpm db:migrate` to apply.

## Verifying RLS

```bash
node -e "
import postgres from 'postgres';
const app = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const r1 = await app\`SELECT count(*)::int AS n FROM workspaces\`;
console.log('No scope:', r1[0].n, '(expect 0)');
await app\`SELECT set_config('app.current_workspace_id', '<UUID>', false)\`;
const r2 = await app\`SELECT count(*)::int AS n FROM workspaces\`;
console.log('Scoped:', r2[0].n, '(expect 1)');
await app.end();
"
```
