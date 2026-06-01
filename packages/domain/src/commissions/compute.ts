// Pure per-installment per-recipient computation. No DB. Caller is
// responsible for loading installments + recipients + matched rules.
//
// Math:
//   amount = base × recipient.sharePct
//   base   = installment.actualAmount (rule.paidOn='collected' AND installment is collected)
//          | installment.expectedAmount (otherwise)
//   pendingUntil = (installment.collectedAt OR installment.expectedDate) + holdDays
//   availableAt  = pendingUntil
//
// Rounding: 2dp; per-installment penny remainder allocated to highest-share
// recipient so per-installment sum equals base exactly.

export type ComputeRecipient = {
  recipientId: string;
  userId: string;
  salesRoleId: string;
  salesRoleVersionId: string;
  recipientSource: string;
  sharePct: number; // 0–1
  ruleId: string | null;
  ruleVersionId: string | null;
  ruleHoldDays: number;
  rulePaidOn: string;
  ruleCurrency: string;
};

export type ComputeInstallment = {
  id: string;
  expectedAmount: string;
  actualAmount: string | null;
  expectedDate: string; // ISO date, no tz
  collectedAt: Date | null;
  status: string;
  currency: string;
};

export type ComputedEntry = {
  installmentId: string;
  recipientId: string;
  userId: string;
  salesRoleId: string;
  salesRoleVersionId: string;
  ruleId: string | null;
  ruleVersionId: string | null;
  amount: string; // numeric(14,2) decimal string
  currency: string;
  pendingUntil: Date;
  availableAt: Date;
  computedFrom: Record<string, unknown>;
};

const DAY_MS = 24 * 3600 * 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function explainBase(installment: ComputeInstallment, paidOn: string) {
  if (paidOn === "collected" && installment.actualAmount && installment.status === "collected") {
    return {
      amount: Number(installment.actualAmount),
      source: "actual_amount",
      reason: "paid_on_collected_and_installment_collected",
    };
  }
  return {
    amount: Number(installment.expectedAmount),
    source: "expected_amount",
    reason: paidOn === "booked" ? "paid_on_booked" : "installment_not_collected",
  };
}

function explainHold(installment: ComputeInstallment, holdDays: number) {
  const anchor = installment.collectedAt
    ? installment.collectedAt
    : new Date(`${installment.expectedDate}T00:00:00Z`);
  return {
    anchor,
    anchorSource: installment.collectedAt ? "collected_at" : "expected_date",
    pendingUntil: new Date(anchor.getTime() + holdDays * DAY_MS),
  };
}

export function computeEntriesForInstallment(
  installment: ComputeInstallment,
  recipients: ComputeRecipient[],
): ComputedEntry[] {
  if (recipients.length === 0) return [];

  // Single base for the installment (recipients can each have a different
  // rule, but we want their amounts to sum to the same `base`. We use the
  // first recipient's rule.paidOn to decide. In practice all recipients
  // should be on rules with the same paidOn for sane configurations.)
  const primary = recipients[0]!;
  const baseExplanation = explainBase(installment, primary.rulePaidOn);
  const base = baseExplanation.amount;

  // First pass — raw amounts.
  const raw = recipients.map((r) => round2(base * r.sharePct));
  const sum = round2(raw.reduce((a, b) => a + b, 0));
  const remainder = round2(base - sum);

  if (Math.abs(remainder) >= 0.005) {
    // Allocate to the highest-share recipient (deterministic on ties:
    // first index wins).
    let topIdx = 0;
    for (let i = 1; i < recipients.length; i++) {
      if (recipients[i]!.sharePct > recipients[topIdx]!.sharePct) topIdx = i;
    }
    raw[topIdx] = round2(raw[topIdx]! + remainder);
  }

  return recipients.map((r, i) => {
    const hold = explainHold(installment, r.ruleHoldDays);
    return {
      installmentId: installment.id,
      recipientId: r.recipientId,
      userId: r.userId,
      salesRoleId: r.salesRoleId,
      salesRoleVersionId: r.salesRoleVersionId,
      ruleId: r.ruleId,
      ruleVersionId: r.ruleVersionId,
      amount: raw[i]!.toFixed(2),
      currency: r.ruleCurrency,
      pendingUntil: hold.pendingUntil,
      availableAt: hold.pendingUntil,
      computedFrom: {
        base: base.toFixed(2),
        baseSource: baseExplanation.source,
        baseReason: baseExplanation.reason,
        sharePct: r.sharePct,
        holdDays: r.ruleHoldDays,
        holdReason: `${r.ruleHoldDays} day hold from ${hold.anchorSource}`,
        paidOn: r.rulePaidOn,
        installmentStatus: installment.status,
        anchor: hold.anchor.toISOString(),
        explanation: {
          matchedRule: {
            ruleId: r.ruleId,
            ruleVersionId: r.ruleVersionId,
            paidOn: r.rulePaidOn,
            holdDays: r.ruleHoldDays,
            currency: r.ruleCurrency,
          },
          recipient: {
            recipientId: r.recipientId,
            userId: r.userId,
            salesRoleId: r.salesRoleId,
            salesRoleVersionId: r.salesRoleVersionId,
            source: r.recipientSource,
            sharePct: r.sharePct,
          },
          amount: {
            base: base.toFixed(2),
            baseSource: baseExplanation.source,
            baseReason: baseExplanation.reason,
            sharePct: r.sharePct,
            computedAmount: raw[i]!.toFixed(2),
            currency: r.ruleCurrency,
          },
          hold: {
            holdDays: r.ruleHoldDays,
            anchor: hold.anchor.toISOString(),
            anchorSource: hold.anchorSource,
            pendingUntil: hold.pendingUntil.toISOString(),
          },
        },
      },
    };
  });
}
