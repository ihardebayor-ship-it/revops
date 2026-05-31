// Smoke tests — every PR runs these. They must pass before we trust
// the system to be alive end-to-end. No DB seeding required; CI uses
// stub database URLs, so these only hit public pages.

import { expect, test } from "@playwright/test";

test.describe("smoke", () => {
  test("sign-in page renders", async ({ page }) => {
    await page.goto("/sign-in");

    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });

  test("sign-up page renders", async ({ page }) => {
    await page.goto("/sign-up");

    await expect(page.getByRole("heading", { name: /create your account/i })).toBeVisible();
    await expect(page.getByLabel(/name/i)).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });
});
