// Standalone migration runner. Used by `pnpm db:migrate`.
// Runs the hand-rolled extensions SQL first, then drizzle-kit-generated migrations.
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const client = postgres(url, { max: 1, prepare: false });

  console.info("Enabling pgcrypto + vector extensions…");
  const extensionsSql = readFileSync("./drizzle/0000-extensions.sql", "utf8");
  await client.unsafe(extensionsSql);
  console.info("  ✓ extensions enabled");

  const db = drizzle(client);
  console.info("Running drizzle migrations…");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.info("  ✓ migrations complete");

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
