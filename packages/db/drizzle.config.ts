import { defineConfig } from "drizzle-kit";

// `generate` does not need a DB connection. `push`, `studio`, and `migrate`
// do — they will fail noisily at command time if DATABASE_URL is missing.
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://noop" },
  verbose: true,
  strict: true,
});
