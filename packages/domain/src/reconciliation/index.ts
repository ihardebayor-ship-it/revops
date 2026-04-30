// Reconciliation domain — fuzzy match unlinked sales to candidate calls.
// Pure scorer (no DB) + a wrapper that pulls candidates from the DB and
// ranks them by score. Ports the heuristic from the old app's
// `useUnlinkedSales.ts` (Levenshtein-2 fuzzy email + phone normalize +
// name token overlap + amount match + time proximity).

import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";

export type ScoreSignal =
  | "email_exact"
  | "email_fuzzy"
  | "phone_match"
  | "name_overlap"
  | "amount_match"
  | "date_proximity";

export type ScoreInput = {
  call: {
    contactEmail: string | null;
    contactPhone: string | null;
    contactName: string | null;
    appointmentAt: Date | null;
  };
  sale: {
    customerEmail: string | null;
    customerName: string | null;
    customerPhone: string | null;
    bookedAmount: string;
    closedAt: Date;
  };
  // Optional: an installment this sale belongs to (for amount match against
  // installment.expected_amount).
  installmentExpectedAmount?: string | null;
};

export type Score = {
  score: number; // 0–1
  signals: ScoreSignal[];
};

const WEIGHTS: Record<ScoreSignal, number> = {
  email_exact: 1.0,
  email_fuzzy: 0.6,
  phone_match: 0.7,
  name_overlap: 0.3,
  amount_match: 0.4,
  date_proximity: 0.2,
};

function normalizeEmail(s: string | null): string | null {
  if (!s) return null;
  return s.trim().toLowerCase();
}

function normalizePhone(s: string | null): string | null {
  if (!s) return null;
  const digits = s.replace(/\D+/g, "");
  return digits.length >= 7 ? digits : null;
}

function normalizeNameTokens(s: string | null): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .split(/[\s.,'-]+/)
    .filter((t) => t.length >= 2);
}

/**
 * Levenshtein distance, capped at `max` so we early-exit on long strings
 * we'll never accept. Pure function — no allocations beyond the matrix.
 */
function levenshtein(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!;
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + cost);
      prev = tmp;
      if (dp[j]! < rowMin) rowMin = dp[j]!;
    }
    if (rowMin > max) return max + 1;
  }
  return dp[n]!;
}

function fuzzyEmail(a: string, b: string): boolean {
  if (a === b) return false; // exact handled separately
  // Compare local-part and domain separately so "alex@gmial.com" vs
  // "alex@gmail.com" matches even though the domain typo is small.
  const [aLocal, aDomain] = a.split("@");
  const [bLocal, bDomain] = b.split("@");
  if (!aLocal || !bLocal) return false;
  if (aLocal === bLocal && aDomain && bDomain) {
    return levenshtein(aDomain, bDomain, 2) <= 2;
  }
  if (aDomain === bDomain && aLocal && bLocal) {
    return levenshtein(aLocal, bLocal, 2) <= 2;
  }
  return levenshtein(a, b, 3) <= 3;
}

/**
 * Pure scorer. Composes signals into a single 0–1 confidence and the
 * list of signals that fired. Caller decides on a threshold (typically
 * accept >= 0.7).
 */
export function scoreCallSaleMatch(input: ScoreInput): Score {
  const signals: ScoreSignal[] = [];
  let weightSum = 0;
  let weightFloor = 0;

  // Email
  const callEmail = normalizeEmail(input.call.contactEmail);
  const saleEmail = normalizeEmail(input.sale.customerEmail);
  if (callEmail && saleEmail) {
    weightFloor += WEIGHTS.email_exact;
    if (callEmail === saleEmail) {
      signals.push("email_exact");
      weightSum += WEIGHTS.email_exact;
    } else if (fuzzyEmail(callEmail, saleEmail)) {
      signals.push("email_fuzzy");
      weightSum += WEIGHTS.email_fuzzy;
    }
  }

  // Phone
  const callPhone = normalizePhone(input.call.contactPhone);
  const salePhone = normalizePhone(input.sale.customerPhone);
  if (callPhone && salePhone) {
    weightFloor += WEIGHTS.phone_match;
    // Match on last-7 (handles country code drift).
    if (callPhone.slice(-7) === salePhone.slice(-7)) {
      signals.push("phone_match");
      weightSum += WEIGHTS.phone_match;
    }
  }

  // Name overlap (≥1 shared token of length ≥2)
  const callTokens = new Set(normalizeNameTokens(input.call.contactName));
  const saleTokens = normalizeNameTokens(input.sale.customerName);
  if (callTokens.size > 0 && saleTokens.length > 0) {
    weightFloor += WEIGHTS.name_overlap;
    if (saleTokens.some((t) => callTokens.has(t))) {
      signals.push("name_overlap");
      weightSum += WEIGHTS.name_overlap;
    }
  }

  // Amount match (exact or within $1)
  if (input.installmentExpectedAmount) {
    weightFloor += WEIGHTS.amount_match;
    if (Math.abs(Number(input.sale.bookedAmount) - Number(input.installmentExpectedAmount)) <= 1) {
      signals.push("amount_match");
      weightSum += WEIGHTS.amount_match;
    }
  }

  // Date proximity (within 14 days of appointment → close)
  if (input.call.appointmentAt) {
    weightFloor += WEIGHTS.date_proximity;
    const deltaMs = Math.abs(input.sale.closedAt.getTime() - input.call.appointmentAt.getTime());
    if (deltaMs <= 14 * 24 * 3600 * 1000) {
      signals.push("date_proximity");
      weightSum += WEIGHTS.date_proximity;
    }
  }

  const score = weightFloor === 0 ? 0 : Math.min(weightSum / weightFloor, 1);
  return { score: Number(score.toFixed(3)), signals };
}

export type SuggestedLink = {
  callId: string;
  score: number;
  signals: ScoreSignal[];
  call: {
    id: string;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    appointmentAt: Date | null;
  };
};

/**
 * Suggest top-K candidate calls for a given unlinked sale. Filters to
 * calls in the same sub_account closed within ±14 days of the sale,
 * then scores each one. Returns those with score ≥ 0.3.
 */
export async function suggestLinksForSale(
  db: Db,
  args: { saleId: string; workspaceId: string; limit?: number },
): Promise<SuggestedLink[]> {
  const limit = Math.min(args.limit ?? 5, 50);

  const [sale] = await db
    .select({
      id: schema.sales.id,
      subAccountId: schema.sales.subAccountId,
      customerId: schema.sales.customerId,
      bookedAmount: schema.sales.bookedAmount,
      closedAt: schema.sales.closedAt,
    })
    .from(schema.sales)
    .where(
      and(
        eq(schema.sales.id, args.saleId),
        eq(schema.sales.workspaceId, args.workspaceId),
        isNull(schema.sales.deletedAt),
      ),
    )
    .limit(1);
  if (!sale) return [];

  // Pull customer for email/phone/name
  const [customer] = await db
    .select({
      primaryEmail: schema.customers.primaryEmail,
      name: schema.customers.name,
      phone: schema.customers.phone,
    })
    .from(schema.customers)
    .where(eq(schema.customers.id, sale.customerId ?? ""))
    .limit(1);

  const lower = new Date(sale.closedAt.getTime() - 14 * 24 * 3600 * 1000);
  const upper = new Date(sale.closedAt.getTime() + 14 * 24 * 3600 * 1000);

  const candidates = await db
    .select({
      id: schema.calls.id,
      contactName: schema.calls.contactName,
      contactEmail: schema.calls.contactEmail,
      contactPhone: schema.calls.contactPhone,
      appointmentAt: schema.calls.appointmentAt,
    })
    .from(schema.calls)
    .where(
      and(
        eq(schema.calls.subAccountId, sale.subAccountId),
        isNull(schema.calls.deletedAt),
        isNull(schema.calls.linkedSaleId),
        gte(schema.calls.appointmentAt, lower),
        lte(schema.calls.appointmentAt, upper),
      ),
    )
    .orderBy(desc(schema.calls.appointmentAt))
    .limit(50);

  const scored: SuggestedLink[] = [];
  for (const call of candidates) {
    const result = scoreCallSaleMatch({
      call: {
        contactEmail: call.contactEmail,
        contactPhone: call.contactPhone,
        contactName: call.contactName,
        appointmentAt: call.appointmentAt,
      },
      sale: {
        customerEmail: customer?.primaryEmail ?? null,
        customerName: customer?.name ?? null,
        customerPhone: customer?.phone ?? null,
        bookedAmount: sale.bookedAmount,
        closedAt: sale.closedAt,
      },
    });
    if (result.score >= 0.3) {
      scored.push({ callId: call.id, score: result.score, signals: result.signals, call });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export async function unlinkedSalesQueue(
  db: Db,
  args: { subAccountId: string; limit?: number },
) {
  void sql; // imported for raw queries; reserved for view-driven version
  return db
    .select({
      id: schema.sales.id,
      productName: schema.sales.productName,
      bookedAmount: schema.sales.bookedAmount,
      currency: schema.sales.currency,
      closedAt: schema.sales.closedAt,
      customerId: schema.sales.customerId,
    })
    .from(schema.sales)
    .where(
      and(
        eq(schema.sales.subAccountId, args.subAccountId),
        isNull(schema.sales.linkedCallId),
        isNull(schema.sales.deletedAt),
      ),
    )
    .orderBy(desc(schema.sales.closedAt))
    .limit(args.limit ?? 50);
}
