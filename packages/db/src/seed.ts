// Seed script for fresh installations. Idempotent — safe to re-run.
// Seeds: platform_settings singleton, default disposition presets reference,
// topology preset metadata.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { BRAND_DEFAULTS } from "@revops/config/brand";
import { platformSettings } from "./schema/platform";
import * as schema from "./schema/index";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const client = postgres(url, { max: 1, prepare: false });
  const db = drizzle(client, { schema, casing: "snake_case" });

  console.info("Seeding platform_settings…");
  const existing = await db.select().from(platformSettings).limit(1);
  if (existing.length === 0) {
    await db.insert(platformSettings).values({
      brandName: BRAND_DEFAULTS.name,
      brandTagline: BRAND_DEFAULTS.tagline,
      supportEmail: BRAND_DEFAULTS.supportEmail,
      primaryColor: BRAND_DEFAULTS.primaryColor,
      agentPersona: {
        name: BRAND_DEFAULTS.agentPersona.name,
        voice: BRAND_DEFAULTS.agentPersona.voice,
        forbiddenPhrases: [...BRAND_DEFAULTS.agentPersona.forbiddenPhrases],
      },
    });
    console.info("  ✓ platform_settings inserted");
  } else {
    console.info("  ✓ platform_settings already exists");
  }

  await client.end();
  console.info("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
