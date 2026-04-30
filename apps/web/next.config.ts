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
    "@revops/trpc",
    "@revops/ui",
  ],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
