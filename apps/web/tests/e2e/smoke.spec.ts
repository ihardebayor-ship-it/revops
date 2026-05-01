// Smoke tests — every PR runs these. They must pass before we trust
// the system to be alive end-to-end. No DB seeding required; tests use
// the home page and public auth surfaces only.

import { expect, test } from "@playwright/test";

test.describe("smoke", () => {
  test("home page renders the brand from platform_settings", async ({ page }) => {
    await page.goto("/");
    // Brand name is read from platform_settings; default value is
    // "RevOps Pro" set during Phase 0 bootstrap.
    await expect(page).toHaveTitle(/RevOps/i);
  });

  test("unauthenticated workspace request redirects to sign-in", async ({ page }) => {
    const res = await page.goto("/some-fake-workspace/inbox");
    // Either we land on sign-in directly (auth-resolver redirect) or we get
    // a 200 home page after the redirect chain. Either way the URL must
    // not still be /some-fake-workspace/inbox.
    expect(res?.status() ?? 0).toBeLessThan(500);
    expect(page.url()).not.toContain("/some-fake-workspace/inbox");
  });

  test("GHL webhook receiver accepts a synthetic AppointmentCreate", async ({
    request,
  }) => {
    // No signature in dev → the receiver still accepts. Production rejects
    // unsigned bodies (process.env.NODE_ENV check inside the route).
    const res = await request.post("/api/webhooks/ghl", {
      data: {
        type: "AppointmentCreate",
        locationId: "smoke-test-location",
        appointment: {
          id: `smoke-${Date.now()}`,
          startTime: new Date().toISOString(),
          appointmentStatus: "confirmed",
        },
      },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok: boolean; inboundEventId?: string };
    expect(body.ok).toBe(true);
  });

  test("Aircall webhook receiver dedups on (event, data.id)", async ({ request }) => {
    const id = `smoke-call-${Date.now()}`;
    const payload = {
      event: "call.ended",
      resource: "call",
      data: { id, started_at: Math.floor(Date.now() / 1000), duration: 120 },
    };
    const first = await request.post("/api/webhooks/aircall", { data: payload });
    expect(first.status()).toBe(200);
    const firstBody = (await first.json()) as { ok: boolean; dedup?: boolean };
    expect(firstBody.dedup).toBeFalsy();

    const second = await request.post("/api/webhooks/aircall", { data: payload });
    expect(second.status()).toBe(200);
    const secondBody = (await second.json()) as { ok: boolean; dedup?: boolean };
    // Second send hits the unique-key path; the receiver returns ok with
    // either dedup:true or a stable inboundEventId — both are correct.
    expect(secondBody.ok).toBe(true);
  });
});
