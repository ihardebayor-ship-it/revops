// Commission rules domain — workspace-admin CRUD over commission_rules.
//
// Every write snapshots the rule into commission_rule_versions BEFORE the
// canonical row mutates. The engine references rule_version_id on every
// commission_entries row, so editing a rule mid-quarter never rewrites
// history.
//
// Phase 1 ships the flat_rate type only. tiered/bonus/override/accelerator
// are reserved in the enum but rejected here until Phase 2 implements them.

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";

export type Match =
  | { kind: "any" }
  | { kind: "name"; value: string };

export type CommissionRuleListItem = {
  id: string;
  name: string;
  type: string;
  salesRoleId: string | null;
  salesRoleLabel: string | null;
  sharePct: string | null;
  flatAmount: string | null;
  currency: string;
  productMatch: Match | null;
  sourceMatch: Match | null;
  holdDays: number;
  paidOn: string;
  isActive: number;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  createdAt: Date;
};

export async function listCommissionRules(
  db: Db,
  workspaceId: string,
): Promise<CommissionRuleListItem[]> {
  return db
    .select({
      id: schema.commissionRules.id,
      name: schema.commissionRules.name,
      type: schema.commissionRules.type,
      salesRoleId: schema.commissionRules.salesRoleId,
      salesRoleLabel: schema.salesRoles.label,
      sharePct: schema.commissionRules.sharePct,
      flatAmount: schema.commissionRules.flatAmount,
      currency: schema.commissionRules.currency,
      productMatch: schema.commissionRules.productMatch,
      sourceMatch: schema.commissionRules.sourceMatch,
      holdDays: schema.commissionRules.holdDays,
      paidOn: schema.commissionRules.paidOn,
      isActive: schema.commissionRules.isActive,
      effectiveFrom: schema.commissionRules.effectiveFrom,
      effectiveTo: schema.commissionRules.effectiveTo,
      createdAt: schema.commissionRules.createdAt,
    })
    .from(schema.commissionRules)
    .leftJoin(schema.salesRoles, eq(schema.salesRoles.id, schema.commissionRules.salesRoleId))
    .where(
      and(
        eq(schema.commissionRules.workspaceId, workspaceId),
        isNull(schema.commissionRules.deletedAt),
      ),
    )
    .orderBy(asc(schema.commissionRules.name));
}

export type CreateCommissionRuleInput = {
  workspaceId: string;
  actorUserId: string;
  name: string;
  type: "flat_rate"; // Phase 1 cap
  salesRoleId: string | null;
  sharePct: string | null;
  flatAmount: string | null;
  currency?: string;
  productMatch?: Match;
  sourceMatch?: Match;
  holdDays?: number;
  paidOn?: string;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
};

export async function createCommissionRule(db: Db, input: CreateCommissionRuleInput) {
  validateAmounts(input.sharePct, input.flatAmount);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.commissionRules)
      .values({
        workspaceId: input.workspaceId,
        name: input.name,
        type: input.type,
        salesRoleId: input.salesRoleId,
        sharePct: input.sharePct,
        flatAmount: input.flatAmount,
        currency: input.currency ?? "USD",
        productMatch: input.productMatch ?? { kind: "any" },
        sourceMatch: input.sourceMatch ?? { kind: "any" },
        holdDays: input.holdDays ?? 30,
        paidOn: input.paidOn ?? "collected",
        isActive: 1,
        effectiveFrom: input.effectiveFrom ?? null,
        effectiveTo: input.effectiveTo ?? null,
        createdBy: input.actorUserId,
      })
      .returning({ id: schema.commissionRules.id });
    if (!row) throw new Error("Failed to insert commission rule");

    await tx.insert(schema.commissionRuleVersions).values({
      commissionRuleId: row.id,
      version: 1,
      snapshot: {
        name: input.name,
        type: input.type,
        salesRoleId: input.salesRoleId,
        sharePct: input.sharePct,
        flatAmount: input.flatAmount,
        currency: input.currency ?? "USD",
        productMatch: input.productMatch ?? { kind: "any" },
        sourceMatch: input.sourceMatch ?? { kind: "any" },
        holdDays: input.holdDays ?? 30,
        paidOn: input.paidOn ?? "collected",
      },
      createdBy: input.actorUserId,
    });

    return { ruleId: row.id };
  });
}

export type UpdateCommissionRuleInput = {
  ruleId: string;
  workspaceId: string;
  actorUserId: string;
  patch: Partial<{
    name: string;
    salesRoleId: string | null;
    sharePct: string | null;
    flatAmount: string | null;
    currency: string;
    productMatch: Match;
    sourceMatch: Match;
    holdDays: number;
    paidOn: string;
    isActive: number;
    effectiveFrom: Date | null;
    effectiveTo: Date | null;
  }>;
};

export async function updateCommissionRule(db: Db, input: UpdateCommissionRuleInput) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.commissionRules)
      .where(
        and(
          eq(schema.commissionRules.id, input.ruleId),
          eq(schema.commissionRules.workspaceId, input.workspaceId),
          isNull(schema.commissionRules.deletedAt),
        ),
      )
      .limit(1);
    if (!current) throw new Error("Commission rule not found");

    const next = {
      name: input.patch.name ?? current.name,
      salesRoleId:
        input.patch.salesRoleId === undefined ? current.salesRoleId : input.patch.salesRoleId,
      sharePct: input.patch.sharePct === undefined ? current.sharePct : input.patch.sharePct,
      flatAmount:
        input.patch.flatAmount === undefined ? current.flatAmount : input.patch.flatAmount,
      currency: input.patch.currency ?? current.currency,
      productMatch: input.patch.productMatch ?? current.productMatch,
      sourceMatch: input.patch.sourceMatch ?? current.sourceMatch,
      holdDays: input.patch.holdDays ?? current.holdDays,
      paidOn: input.patch.paidOn ?? current.paidOn,
      isActive: input.patch.isActive ?? current.isActive,
      effectiveFrom:
        input.patch.effectiveFrom === undefined
          ? current.effectiveFrom
          : input.patch.effectiveFrom,
      effectiveTo:
        input.patch.effectiveTo === undefined ? current.effectiveTo : input.patch.effectiveTo,
    };

    validateAmounts(next.sharePct, next.flatAmount);

    const [latestVersion] = await tx
      .select({ version: schema.commissionRuleVersions.version })
      .from(schema.commissionRuleVersions)
      .where(eq(schema.commissionRuleVersions.commissionRuleId, input.ruleId))
      .orderBy(desc(schema.commissionRuleVersions.version))
      .limit(1);
    const nextVersion = (latestVersion?.version ?? 0) + 1;

    await tx.insert(schema.commissionRuleVersions).values({
      commissionRuleId: input.ruleId,
      version: nextVersion,
      snapshot: {
        name: next.name,
        type: current.type,
        salesRoleId: next.salesRoleId,
        sharePct: next.sharePct,
        flatAmount: next.flatAmount,
        currency: next.currency,
        productMatch: next.productMatch,
        sourceMatch: next.sourceMatch,
        holdDays: next.holdDays,
        paidOn: next.paidOn,
      },
      createdBy: input.actorUserId,
    });

    await tx
      .update(schema.commissionRules)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(schema.commissionRules.id, input.ruleId));

    return { ruleId: input.ruleId, newVersion: nextVersion };
  });
}

export async function softDeleteCommissionRule(
  db: Db,
  args: { ruleId: string; workspaceId: string },
) {
  await db
    .update(schema.commissionRules)
    .set({ deletedAt: new Date(), isActive: 0, updatedAt: new Date() })
    .where(
      and(
        eq(schema.commissionRules.id, args.ruleId),
        eq(schema.commissionRules.workspaceId, args.workspaceId),
      ),
    );
  return { ruleId: args.ruleId };
}

function validateAmounts(sharePct: string | null, flatAmount: string | null): void {
  // Exactly one of share_pct OR flat_amount must be set for a flat-rate rule.
  const hasShare = sharePct !== null && sharePct !== "";
  const hasFlat = flatAmount !== null && flatAmount !== "";
  if (!hasShare && !hasFlat) {
    throw new Error("Provide either sharePct (0–1) or flatAmount, not both empty");
  }
  if (hasShare && hasFlat) {
    throw new Error("Provide either sharePct OR flatAmount, not both");
  }
  if (hasShare) {
    const n = Number(sharePct);
    if (!(n >= 0 && n <= 1)) throw new Error(`sharePct must be 0–1 (got ${sharePct})`);
  }
  if (hasFlat) {
    const n = Number(flatAmount);
    if (!(n >= 0)) throw new Error(`flatAmount must be >= 0 (got ${flatAmount})`);
  }
}
