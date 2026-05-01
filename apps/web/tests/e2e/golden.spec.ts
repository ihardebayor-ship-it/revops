// Golden flow — the full Phase 1 happy path. Runs against a fresh
// workspace seeded specifically for this test (so the assertions are
// deterministic against known IDs).
//
// Status: SCAFFOLDED. The setup harness (programmatic sign-up, topology
// selection, deterministic ID seeding) is the next piece of work; the
// shape below is the intended structure. Currently skipped in CI so it
// doesn't block PRs while the harness lands.
//
// To run locally once the harness ships:
//   pnpm dev (other terminal)
//   PLAYWRIGHT_RUN_GOLDEN=1 pnpm test:e2e -g golden

import { expect, test } from "@playwright/test";

const RUN_GOLDEN = process.env.PLAYWRIGHT_RUN_GOLDEN === "1";

test.describe("golden flow (Phase 1 happy path)", () => {
  test.skip(!RUN_GOLDEN, "Set PLAYWRIGHT_RUN_GOLDEN=1 once the seed harness is live");

  test("sign-up → onboarding → call → sale → fast-forward → commission visible", async ({
    page,
    request,
  }) => {
    // 1. Sign-up + onboarding
    const email = `golden-${Date.now()}@example.test`;
    await page.goto("/sign-up");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill("test-password-1234");
    await page.getByRole("button", { name: /sign up/i }).click();

    await expect(page).toHaveURL(/onboarding/);
    await page.getByRole("button", { name: /setter \+ closer/i }).click();
    await page.getByRole("button", { name: /continue/i }).click();

    // 2. Land in workspace shell. Slug is created during bootstrap; read
    // it from the URL after onboarding completes.
    await expect(page).toHaveURL(/\/[^/]+\/inbox/);
    const slug = new URL(page.url()).pathname.split("/")[1]!;

    // 3. Log a call, set disposition.
    await page.goto(`/${slug}/calls/new`);
    await page.getByLabel(/contact email/i).fill("buyer@example.test");
    await page.getByRole("button", { name: /save/i }).click();
    await page.getByRole("combobox", { name: /disposition/i }).selectOption({ label: "Won" });

    // 4. Log a $5,000 sale on a 3-installment plan.
    await page.goto(`/${slug}/sales/new`);
    await page.getByLabel(/customer email/i).fill("buyer@example.test");
    await page.getByLabel(/booked amount/i).fill("5000.00");
    await page.getByRole("checkbox", { name: /payment plan/i }).check();
    await page.getByLabel(/total installments/i).fill("3");
    await page.getByLabel(/installment amount/i).fill("1666.67");
    await page.getByRole("button", { name: /create/i }).click();

    // 5. Fast-forward + release via the dev test endpoints — these are
    // idempotent and unauthenticated callers in dev get blocked, so we
    // need the active session cookie. page.context() carries it.
    const saleUrl = page.url();
    const saleId = saleUrl.split("/").pop()!;

    const ff = await request.post("/api/test/commission-fast-forward", {
      data: { saleId, days: 31 },
    });
    expect(ff.ok()).toBe(true);

    const release = await request.post("/api/test/commission-release");
    expect(release.ok()).toBe(true);

    // 6. Commission shows up on the closer dashboard with status='available'.
    await page.goto(`/${slug}/commissions?status=available`);
    await expect(page.getByText(/available/i)).toBeVisible();
    await expect(page.locator("body")).toContainText(/\$/);
  });
});
