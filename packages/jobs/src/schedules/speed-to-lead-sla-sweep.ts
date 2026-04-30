// Speed-to-lead SLA sweep — fires every minute. Body lives in
// @revops/domain/optins.runSpeedToLeadSweep so the dev-only manual trigger
// at /api/test/sla-sweep can run the exact same logic.
//
// Idempotent: tasks.unique_key='speed_to_lead:{optinId}' enforces one task
// per optin under retry/replay.

import { NonRetriableError } from "inngest";
import { bypassRls } from "@revops/db/client";
import { optins as optinsDomain } from "@revops/domain";
import { inngest } from "../client";

export const speedToLeadSlaSweep = inngest.createFunction(
  {
    id: "speed-to-lead-sla-sweep",
    concurrency: { limit: 1 },
    retries: 1,
  },
  { cron: "* * * * *" },
  async ({ step }) => {
    return step
      .run("scan-and-upsert", () => bypassRls((db) => optinsDomain.runSpeedToLeadSweep(db)))
      .catch((err) => {
        throw new NonRetriableError(`SLA sweep failed: ${err instanceof Error ? err.message : err}`);
      });
  },
);
