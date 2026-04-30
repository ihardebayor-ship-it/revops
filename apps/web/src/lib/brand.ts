// Reads brand from platform_settings (with optional tenant whitelabel
// override). Cached at the React Server Component level via React.cache so
// every component in a request shares one DB read.
import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb } from "@revops/db/client";
import { platformSettings, tenantSettings } from "@revops/db/schema";
import { BRAND_DEFAULTS, type BrandConfig } from "@revops/config/brand";

export const getBrand = cache(async (workspaceId?: string): Promise<BrandConfig> => {
  const db = getDb();

  const platformRow = await db.select().from(platformSettings).limit(1);
  const platform = platformRow[0];

  let tenant: typeof tenantSettings.$inferSelect | undefined;
  if (workspaceId) {
    const rows = await db
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.workspaceId, workspaceId))
      .limit(1);
    tenant = rows[0];
  }

  if (tenant?.whitelabelEnabled) {
    return {
      name: tenant.brandName ?? platform?.brandName ?? BRAND_DEFAULTS.name,
      tagline: platform?.brandTagline ?? BRAND_DEFAULTS.tagline,
      supportEmail:
        tenant.supportEmail ?? platform?.supportEmail ?? BRAND_DEFAULTS.supportEmail,
      primaryColor:
        tenant.primaryColor ?? platform?.primaryColor ?? BRAND_DEFAULTS.primaryColor,
      logoUrl: tenant.logoUrl ?? platform?.logoUrl ?? undefined,
      agentPersona: {
        name: tenant.agentPersona?.name ?? platform?.agentPersona.name ?? BRAND_DEFAULTS.agentPersona.name,
        voice:
          tenant.agentPersona?.voice ??
          platform?.agentPersona.voice ??
          BRAND_DEFAULTS.agentPersona.voice,
        forbiddenPhrases:
          tenant.agentPersona?.forbiddenPhrases ??
          platform?.agentPersona.forbiddenPhrases ??
          [...BRAND_DEFAULTS.agentPersona.forbiddenPhrases],
      },
    };
  }

  if (!platform) {
    return {
      name: BRAND_DEFAULTS.name,
      tagline: BRAND_DEFAULTS.tagline,
      supportEmail: BRAND_DEFAULTS.supportEmail,
      primaryColor: BRAND_DEFAULTS.primaryColor,
      agentPersona: {
        name: BRAND_DEFAULTS.agentPersona.name,
        voice: BRAND_DEFAULTS.agentPersona.voice,
        forbiddenPhrases: [...BRAND_DEFAULTS.agentPersona.forbiddenPhrases],
      },
    };
  }

  return {
    name: platform.brandName,
    tagline: platform.brandTagline,
    supportEmail: platform.supportEmail,
    primaryColor: platform.primaryColor,
    logoUrl: platform.logoUrl ?? undefined,
    agentPersona: {
      name: platform.agentPersona.name,
      voice: platform.agentPersona.voice,
      forbiddenPhrases: platform.agentPersona.forbiddenPhrases,
    },
  };
});
