// Brand defaults — these seed `platform_settings` on first boot.
// Runtime brand always reads from the database, never from these constants.
// Renaming the product is a database UPDATE, not a code change.

export const BRAND_DEFAULTS = {
  name: "RevOps Pro",
  tagline: "Agent-native revenue operations for high-ticket sales",
  supportEmail: "support@revops.pro",
  primaryColor: "hsl(216 100% 58%)",
  agentPersona: {
    name: "RevOps",
    voice:
      "professional, concise, never hyperbolic, never sycophantic, calls out tradeoffs, refuses gracefully",
    forbiddenPhrases: ["I'd be happy to", "Certainly!", "Great question"],
  },
} as const;

export type BrandConfig = {
  name: string;
  tagline: string;
  supportEmail: string;
  primaryColor: string;
  logoUrl?: string;
  agentPersona: {
    name: string;
    voice: string;
    forbiddenPhrases: readonly string[];
  };
};
