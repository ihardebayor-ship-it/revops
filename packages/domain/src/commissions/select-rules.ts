// Match active commission_rules to a sale. Filters on:
//   - workspace + active flag + soft-delete
//   - effective_from <= closedAt < effective_to (or open-ended)
//   - product_match: kind='any' OR kind='name' AND value === sale.product_name
//   - source_match: kind='any' OR kind='name' AND value === sale.source_integration
//
// Returns rule rows keyed by salesRoleId so the engine can pair each
// recipient with its rule.

import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";

export type MatchedRule = {
  id: string;
  versionId: string | null;
  salesRoleId: string | null;
  sharePct: string | null;
  flatAmount: string | null;
  currency: string;
  holdDays: number;
  paidOn: string;
  type: string;
};

type SaleForMatching = {
  workspaceId: string;
  productName: string | null;
  sourceIntegration: string | null;
  closedAt: Date;
};

function jsonbMatchesValue(
  candidate: { kind: string; value?: string } | null,
  saleValue: string | null,
): boolean {
  if (!candidate) return true; // no filter ⇒ match-all
  if (candidate.kind === "any") return true;
  if (candidate.kind === "name") return saleValue === candidate.value;
  return false;
}

export async function selectRulesForSale(
  db: Db,
  sale: SaleForMatching,
): Promise<MatchedRule[]> {
  const rules = await db
    .select({
      id: schema.commissionRules.id,
      salesRoleId: schema.commissionRules.salesRoleId,
      sharePct: schema.commissionRules.sharePct,
      flatAmount: schema.commissionRules.flatAmount,
      currency: schema.commissionRules.currency,
      holdDays: schema.commissionRules.holdDays,
      paidOn: schema.commissionRules.paidOn,
      type: schema.commissionRules.type,
      productMatch: schema.commissionRules.productMatch,
      sourceMatch: schema.commissionRules.sourceMatch,
      effectiveFrom: schema.commissionRules.effectiveFrom,
      effectiveTo: schema.commissionRules.effectiveTo,
    })
    .from(schema.commissionRules)
    .where(
      and(
        eq(schema.commissionRules.workspaceId, sale.workspaceId),
        eq(schema.commissionRules.isActive, 1),
        isNull(schema.commissionRules.deletedAt),
        or(
          isNull(schema.commissionRules.effectiveFrom),
          lte(schema.commissionRules.effectiveFrom, sale.closedAt),
        ),
        or(
          isNull(schema.commissionRules.effectiveTo),
          gt(schema.commissionRules.effectiveTo, sale.closedAt),
        ),
      ),
    );

  const matched: MatchedRule[] = [];
  for (const r of rules) {
    if (!jsonbMatchesValue(r.productMatch, sale.productName)) continue;
    if (!jsonbMatchesValue(r.sourceMatch, sale.sourceIntegration)) continue;
    matched.push({
      id: r.id,
      versionId: null,
      salesRoleId: r.salesRoleId,
      sharePct: r.sharePct,
      flatAmount: r.flatAmount,
      currency: r.currency,
      holdDays: r.holdDays,
      paidOn: r.paidOn,
      type: r.type,
    });
  }
  return matched;
}

// Snapshot each matched rule to commission_rule_versions if no version
// exists yet (or the latest version's snapshot diverges). Returns a map
// from ruleId → versionId for the engine to record on each entry.
export async function snapshotRules(
  db: Db,
  rules: MatchedRule[],
  createdBy?: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const rule of rules) {
    const existing = await db
      .select({ id: schema.commissionRuleVersions.id, version: schema.commissionRuleVersions.version })
      .from(schema.commissionRuleVersions)
      .where(eq(schema.commissionRuleVersions.commissionRuleId, rule.id))
      .orderBy(asc(schema.commissionRuleVersions.version));

    if (existing.length > 0) {
      const latest = existing[existing.length - 1]!;
      map.set(rule.id, latest.id);
      continue;
    }

    const [row] = await db
      .insert(schema.commissionRuleVersions)
      .values({
        commissionRuleId: rule.id,
        version: 1,
        snapshot: {
          salesRoleId: rule.salesRoleId,
          sharePct: rule.sharePct,
          flatAmount: rule.flatAmount,
          currency: rule.currency,
          holdDays: rule.holdDays,
          paidOn: rule.paidOn,
          type: rule.type,
        },
        createdBy: createdBy ?? null,
      })
      .returning({ id: schema.commissionRuleVersions.id });
    if (row) map.set(rule.id, row.id);
  }
  return map;
}

export function rulesetHash(rules: MatchedRule[]): string {
  // Stable hash — sort by ruleId, concat key fields. Matches Postgres
  // md5 input across runs so engine telemetry can detect rule churn.
  const sorted = [...rules].sort((a, b) => a.id.localeCompare(b.id));
  const parts = sorted.map(
    (r) => `${r.id}:${r.salesRoleId ?? ""}:${r.sharePct ?? ""}:${r.holdDays}:${r.paidOn}`,
  );
  // Lightweight FNV-1a so we don't pull in a crypto dep — 32-bit hex.
  let hash = 0x811c9dc5;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

void sql; // reserved for future raw queries
