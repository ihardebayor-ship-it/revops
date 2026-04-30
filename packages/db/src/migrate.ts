// Migration runner. Used by `pnpm db:migrate`.
//
// Apply order:
//   1. Hand-rolled `0000-*.sql`        — pre-schema (extensions: pgcrypto, vector)
//   2. drizzle-kit-tracked migrations  — schema (drizzle/_journal.json)
//   3. Hand-rolled `9XXX-*.sql`        — post-schema (RLS helpers + policies)
//
// Hand-rolled files use hyphens (`0000-extensions.sql`); drizzle-generated
// files use underscores (`0001_bitter_slayback.sql`). The hyphen-vs-underscore
// distinction is the unambiguous filter so the runner doesn't try to apply a
// drizzle file twice.
//
// The `9XXX-*` files re-run on every migration so newly-added tables get
// their RLS policies on the same pass that creates them. The policy SQL is
// idempotent (DROP POLICY IF EXISTS, ALTER ROLE … WITH PASSWORD).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const DRIZZLE_DIR = "./drizzle";
const HAND_ROLLED_RE = /^\d{4}-/; // hyphen, not underscore

function listHandRolledByPrefix(prefix: string): string[] {
  return readdirSync(DRIZZLE_DIR)
    .filter((name) => {
      if (!name.endsWith(".sql")) return false;
      if (!HAND_ROLLED_RE.test(name)) return false;
      return name.startsWith(prefix);
    })
    .sort();
}

async function main() {
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_MIGRATION_URL (or DATABASE_URL) is required");
    process.exit(1);
  }
  const appPassword = process.env.REVOPS_APP_DB_PASSWORD;
  if (!appPassword) {
    console.error("REVOPS_APP_DB_PASSWORD is required (embedded in revops_app role)");
    process.exit(1);
  }

  const client = postgres(url, { max: 1, prepare: false });

  // 1. Pre-schema (extensions etc.)
  for (const file of listHandRolledByPrefix("0")) {
    console.info(`Running ${file}…`);
    const sql = readFileSync(join(DRIZZLE_DIR, file), "utf8");
    await client.unsafe(sql);
    console.info(`  ✓ ${file} applied`);
  }

  // 2. drizzle-kit-tracked schema migrations
  console.info("Running drizzle-kit-tracked migrations…");
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: DRIZZLE_DIR });
  console.info("  ✓ drizzle migrations applied");

  // 3. Post-schema (RLS, future hand-rolled idempotent migrations)
  for (const file of listHandRolledByPrefix("9")) {
    console.info(`Running ${file}…`);
    const sql = readFileSync(join(DRIZZLE_DIR, file), "utf8");
    if (file.includes("rls-policies")) {
      // Inject the app-role password as a session GUC so CREATE/ALTER ROLE
      // can read it via current_setting('revops.app_password').
      await client.unsafe(`SET revops.app_password = '${appPassword.replace(/'/g, "''")}'`);
    }
    await client.unsafe(sql);
    console.info(`  ✓ ${file} applied`);
  }

  await client.end();
  console.info("Migrations complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
