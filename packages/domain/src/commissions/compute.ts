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

function pendingUntilFor(installment: ComputeInstallment, holdDays: number): Date {
  const anchor = installment.collectedAt
    ? installment.collectedAt
    : new Date(`${installment.expectedDate}T00:00:00Z`);
  return new Date(anchor.getTime() + holdDays * DAY_MS);
}

function chooseBase(installment: ComputeInstallment, paidOn: string): number {
  if (paidOn === "collected" && installment.actualAmount && installment.status === "collected") {
    return Number(installment.actualAmount);
  }
  return Number(installment.expectedAmount);
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
  const base = chooseBase(installment, primary.rulePaidOn);

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
    const pendingUntil = pendingUntilFor(installment, r.ruleHoldDays);
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
      pendingUntil,
      availableAt: pendingUntil,
      computedFrom: {
        base: base.toFixed(2),
        sharePct: r.sharePct,
        holdDays: r.ruleHoldDays,
        paidOn: r.rulePaidOn,
        installmentStatus: installment.status,
        anchor: installment.collectedAt
          ? installment.collectedAt.toISOString()
          : `${installment.expectedDate}T00:00:00Z`,
      },
    };
  });
}
