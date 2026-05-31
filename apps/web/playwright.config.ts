// Playwright config for Phase 1 M5.7 smoke + golden-flow tests.
// Local: `pnpm dev` in another terminal, then `pnpm test:e2e`. CI runs
// against the already-built app via the webServer hook below.

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? "github" : [["list"]],
  webServer: process.env.CI
    ? {
        command: "pnpm start",
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : undefined,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    actionTimeout: 5_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
