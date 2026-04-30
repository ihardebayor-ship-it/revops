import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

// platform_users — superadmins. Separate from tenant access.
// A row here grants the holder superadmin powers; absence of a row means they
// are a normal tenant user (or no user at all).
export const platformUsers = pgTable("platform_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" })
    .unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by").references(() => user.id),
});

// platform_settings — singleton row holding global brand + defaults.
// Renaming the product, changing the agent persona default, etc. happen here.
export const platformSettings = pgTable("platform_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandName: text("brand_name").notNull().default("RevOps Pro"),
  brandTagline: text("brand_tagline").notNull().default(""),
  supportEmail: text("support_email").notNull().default("support@revops.pro"),
  primaryColor: text("primary_color").notNull().default("hsl(216 100% 58%)"),
  logoUrl: text("logo_url"),
  agentPersona: jsonb("agent_persona").notNull().$type<{
    name: string;
    voice: string;
    forbiddenPhrases: string[];
  }>(),
  defaultEmailFrom: text("default_email_from").notNull().default("noreply@revops.pro"),
  featureFlags: jsonb("feature_flags").notNull().default({}).$type<Record<string, boolean>>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => user.id),
});
