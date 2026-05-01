// Commission engine — Phase 1 entry. Multi-party, installment-based, with
// hold periods. The engine reads workspace commission_rules and produces
// commission_entries (one per recipient per installment) inside a Postgres
// transaction wrapped by an Inngest workflow.
//
// Phase 0: types and pure helpers only. Phase 1: full computation.

import { z } from "zod";

export const commissionRecipientSchema = z.object({
  userId: z.string(),
  salesRoleId: z.string().uuid(),
  sharePct: z.number().min(0).max(1),
  computedAmount: z.string(),
  ruleId: z.string().uuid(),
  ruleVersionId: z.string().uuid(),
});

export type CommissionRecipient = z.infer<typeof commissionRecipientSchema>;

export {
  selectRulesForSale,
  snapshotRules,
  rulesetHash,
  type MatchedRule,
} from "./select-rules";

export {
  computeEntriesForInstallment,
  type ComputedEntry,
  type ComputeRecipient,
  type ComputeInstallment,
} from "./compute";

export {
  recomputeCommissionsForSale,
  releaseAvailableEntries,
  type RecomputeArgs,
  type RecomputeResult,
} from "./recompute";
