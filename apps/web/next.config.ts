import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@revops/agent",
    "@revops/auth",
    "@revops/config",
    "@revops/db",
    "@revops/domain",
    "@revops/integrations",
    "@revops/jobs",
    "@revops/observability",
    "@revops/realtime",
    "@revops/trpc",
    "@revops/ui",
  ],
  // typedRoutes off in Phase 0 — re-enable in Phase 1 M1 when the full
  // route map (sign-in, sign-up, [workspace]/*) lands.
  experimental: {},
};

export default nextConfig;
