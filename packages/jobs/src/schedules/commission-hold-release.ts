// Hold-period release — hourly. Transitions commission_entries from
// pending → available when pendingUntil <= now(). Idempotent.

import { NonRetriableError } from "inngest";
import { bypassRls } from "@revops/db/client";
import { commissions as commissionsDomain } from "@revops/domain";
import { inngest } from "../client";

export const commissionHoldRelease = inngest.createFunction(
  {
    id: "commission-hold-release",
    concurrency: { limit: 1 },
    retries: 1,
  },
  { cron: "0 * * * *" },
  async ({ step }) => {
    return step
      .run("release-available", () =>
        bypassRls((db) => commissionsDomain.releaseAvailableEntries(db)),
      )
      .catch((err) => {
        throw new NonRetriableError(
          `Hold release failed: ${err instanceof Error ? err.message : err}`,
        );
      });
  },
);
