// Shared Tailwind v4 preset. Apps/packages import via:
//   @import "tailwindcss";
//   @config "../../packages/tooling/tailwind.preset.ts";
// (or the equivalent CSS @theme block — Tailwind v4 is CSS-first.)
//
// We keep tokens duplicated in CSS @theme for v4 compatibility and re-export
// them here for any code that needs programmatic access.

export const designTokens = {
  colors: {
    background: "hsl(0 0% 0%)",
    foreground: "hsl(0 0% 98%)",
    card: "hsl(0 0% 4%)",
    cardForeground: "hsl(0 0% 98%)",
    muted: "hsl(0 0% 9%)",
    mutedForeground: "hsl(0 0% 64%)",
    border: "hsl(0 0% 14%)",
    accent: {
      blue: "hsl(216 100% 58%)",
      purple: "hsl(275 100% 64%)",
    },
    semantic: {
      success: "hsl(142 71% 45%)",
      warning: "hsl(38 92% 50%)",
      destructive: "hsl(0 84% 60%)",
      info: "hsl(216 100% 58%)",
    },
  },
  fontFamily: {
    sans: '"Inter", system-ui, -apple-system, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, monospace',
  },
  fontSize: {
    display: "2.25rem",
    h1: "1.875rem",
    h2: "1.5rem",
    h3: "1.25rem",
    body: "0.875rem",
    caption: "0.75rem",
  },
  radius: {
    sm: "0.25rem",
    md: "0.5rem",
    lg: "0.75rem",
  },
} as const;

export type DesignTokens = typeof designTokens;
