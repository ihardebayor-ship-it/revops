// commission.recompute.requested → recomputeCommissionsForSale.
// Concurrency cap per saleId so multiple events for the same sale
// (e.g. installment status flip + rule edit) serialize.

import { NonRetriableError } from "inngest";
import { bypassRls } from "@revops/db/client";
import { commissions as commissionsDomain } from "@revops/domain";
import { inngest } from "../client";

export const commissionRecompute = inngest.createFunction(
  {
    id: "commission-recompute",
    concurrency: [
      { key: "event.data.saleId", limit: 1 },
      { limit: 10 },
    ],
    retries: 2,
  },
  { event: "commission.recompute.requested" },
  async ({ event, step }) => {
    const { saleId, reason } = event.data;
    return step
      .run("recompute", () =>
        bypassRls((db) => commissionsDomain.recomputeCommissionsForSale(db, { saleId, triggeredBy: reason })),
      )
      .catch((err) => {
        throw new NonRetriableError(
          `Commission recompute failed for ${saleId}: ${err instanceof Error ? err.message : err}`,
        );
      });
  },
);
