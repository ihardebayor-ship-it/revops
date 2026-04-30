// Health-check function. Phase 0 placeholder so the Inngest endpoint has at
// least one registered function.
import { inngest } from "../client";

export const healthCheck = inngest.createFunction(
  { id: "health-check" },
  { cron: "0 * * * *" },
  async ({ step }) => {
    await step.run("ping", async () => ({ ok: true, at: new Date().toISOString() }));
    return { ok: true };
  },
);
