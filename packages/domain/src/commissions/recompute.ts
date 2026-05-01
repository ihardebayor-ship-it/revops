// Engine entry point. Wraps select-rules → compute → write-entries
// in a single Postgres transaction guarded by an advisory lock keyed
// on the saleId. Idempotent: re-running for the same sale upserts in
// place and voids entries no longer produced by current rules.
//
// Status transitions handled:
//   - new sale: insert pending entries.
//   - rule change: upsert (refreshes amount/hold) + void obsolete rows.
//   - installment collected (paid_on='collected'): refresh base + dates.
//   - installment failed/skipped: voids the entry for that installment.
//   - paid / clawed_back entries are NEVER rewritten (locked-in history).

import { and, eq, isNull, sql } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";
import { selectRulesForSale, snapshotRules, rulesetHash, type MatchedRule } from "./select-rules";
import { computeEntriesForInstallment, type ComputeRecipient, type ComputeInstallment, type ComputedEntry } from "./compute";

export type RecomputeArgs = {
  saleId: string;
  triggeredBy?: string;
};

export type RecomputeResult = {
  saleId: string;
  recipientCount: number;
  entryCount: number;
  voidedCount: number;
  rulesetHash: string;
  durationMs: number;
};

const ADVISORY_LOCK_NS = 0x434f4d4d; // "COMM"

function saleAdvisoryKey(saleId: string): bigint {
  // Postgres pg_advisory_xact_lock(int8). UUID has no native bigint;
  // we hash the bytes into 64 bits. FNV-1a 64.
  let hash = 0xcbf29ce484222325n;
  const bytes = new TextEncoder().encode(saleId);
  for (const b of bytes) {
    hash ^= BigInt(b);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  // Postgres signed bigint range: shift into signed.
  if (hash >= 0x8000000000000000n) hash -= 0x10000000000000000n;
  return hash;
}

export async function recomputeCommissionsForSale(
  outerDb: Db,
  args: RecomputeArgs,
): Promise<RecomputeResult> {
  const t0 = Date.now();

  return outerDb.transaction(async (tx) => {
    // Serialize all recompute runs for the same sale.
    const lockKey = saleAdvisoryKey(args.saleId);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_NS}::int, ${lockKey}::int)`);

    // 1. Load sale + recipients + installments.
    const [sale] = await tx
      .select({
        id: schema.sales.id,
        workspaceId: schema.sales.workspaceId,
        subAccountId: schema.sales.subAccountId,
        productName: schema.sales.productName,
        sourceIntegration: schema.sales.sourceIntegration,
        closedAt: schema.sales.closedAt,
        currency: schema.sales.currency,
        deletedAt: schema.sales.deletedAt,
      })
      .from(schema.sales)
      .where(eq(schema.sales.id, args.saleId))
      .limit(1);
    if (!sale) throw new Error(`Sale ${args.saleId} not found`);
    if (sale.deletedAt) {
      // Soft-deleted sale: void all non-terminal entries and exit.
      await tx
        .update(schema.commissionEntries)
        .set({ status: "voided", canceledAt: new Date(), canceledReason: "sale_deleted", updatedAt: new Date() })
        .where(
          and(
            eq(schema.commissionEntries.saleId, sale.id),
            sql`${schema.commissionEntries.status} IN ('pending', 'available')`,
          ),
        );
      return { saleId: sale.id, recipientCount: 0, entryCount: 0, voidedCount: 0, rulesetHash: "deleted", durationMs: Date.now() - t0 };
    }

    const recipientRows = await tx
      .select({
        id: schema.commissionRecipients.id,
        userId: schema.commissionRecipients.userId,
        salesRoleId: schema.commissionRecipients.salesRoleId,
        salesRoleVersionId: schema.commissionRecipients.salesRoleVersionId,
        sharePct: schema.commissionRecipients.sharePct,
        currency: schema.commissionRecipients.currency,
      })
      .from(schema.commissionRecipients)
      .where(
        and(
          eq(schema.commissionRecipients.saleId, sale.id),
          isNull(schema.commissionRecipients.deletedAt),
        ),
      );

    const installmentRows = await tx
      .select({
        id: schema.paymentPlanInstallments.id,
        expectedAmount: schema.paymentPlanInstallments.expectedAmount,
        actualAmount: schema.paymentPlanInstallments.actualAmount,
        expectedDate: schema.paymentPlanInstallments.expectedDate,
        collectedAt: schema.paymentPlanInstallments.collectedAt,
        status: schema.paymentPlanInstallments.status,
        currency: schema.paymentPlanInstallments.currency,
      })
      .from(schema.paymentPlanInstallments)
      .where(eq(schema.paymentPlanInstallments.saleId, sale.id));

    // 2. Match rules.
    const matchedRules = await selectRulesForSale(tx, {
      workspaceId: sale.workspaceId,
      productName: sale.productName,
      sourceIntegration: sale.sourceIntegration,
      closedAt: sale.closedAt,
    });
    const versionMap = await snapshotRules(tx, matchedRules, args.triggeredBy);

    // Index rules by salesRoleId for recipient pairing. Multiple rules
    // for one role: prefer the first (deterministic by ID order).
    const ruleByRole = new Map<string, MatchedRule>();
    let defaultRule: MatchedRule | null = null;
    for (const r of matchedRules) {
      if (r.salesRoleId) {
        if (!ruleByRole.has(r.salesRoleId)) ruleByRole.set(r.salesRoleId, r);
      } else if (!defaultRule) {
        defaultRule = r;
      }
    }

    // 3. Pair recipients with rules.
    const computeRecipients: ComputeRecipient[] = recipientRows.map((rcp) => {
      const rule = ruleByRole.get(rcp.salesRoleId) ?? defaultRule;
      return {
        recipientId: rcp.id,
        userId: rcp.userId,
        salesRoleId: rcp.salesRoleId,
        salesRoleVersionId: rcp.salesRoleVersionId,
        sharePct: Number(rcp.sharePct),
        ruleId: rule?.id ?? null,
        ruleVersionId: rule ? versionMap.get(rule.id) ?? null : null,
        ruleHoldDays: rule?.holdDays ?? 30,
        rulePaidOn: rule?.paidOn ?? "collected",
        ruleCurrency: rule?.currency ?? rcp.currency,
      };
    });

    // 4. Compute every (installment × recipient) entry.
    const computeInstallments: ComputeInstallment[] = installmentRows.map((i) => ({
      id: i.id,
      expectedAmount: i.expectedAmount,
      actualAmount: i.actualAmount,
      expectedDate: i.expectedDate,
      collectedAt: i.collectedAt,
      status: i.status,
      currency: i.currency,
    }));

    const allEntries: ComputedEntry[] = [];
    for (const inst of computeInstallments) {
      // Skip terminal installments (failed/skipped/refunded) — engine
      // voids any prior entries for them rather than producing new ones.
      if (inst.status === "failed" || inst.status === "skipped" || inst.status === "refunded") {
        continue;
      }
      allEntries.push(...computeEntriesForInstallment(inst, computeRecipients));
    }

    // 5. Upsert entries. The unique key is
    //    (sale_id, installment_id, recipient_user_id, sales_role_id, rule_id).
    let entryCount = 0;
    const seenKeys = new Set<string>();
    for (const e of allEntries) {
      const key = `${sale.id}|${e.installmentId}|${e.userId}|${e.salesRoleId}|${e.ruleId ?? "NULL"}`;
      seenKeys.add(key);
      // The unique constraint excludes NULL rule_id (Postgres treats NULL
      // as distinct), so we can't ON CONFLICT when ruleId is NULL.
      // For NULL ruleId we delete-then-insert pending/available rows.
      if (e.ruleId === null) {
        await tx
          .delete(schema.commissionEntries)
          .where(
            and(
              eq(schema.commissionEntries.saleId, sale.id),
              eq(schema.commissionEntries.installmentId, e.installmentId),
              eq(schema.commissionEntries.recipientUserId, e.userId),
              eq(schema.commissionEntries.salesRoleId, e.salesRoleId),
              isNull(schema.commissionEntries.ruleId),
              sql`${schema.commissionEntries.status} IN ('pending', 'available')`,
            ),
          );
        await tx.insert(schema.commissionEntries).values({
          workspaceId: sale.workspaceId,
          subAccountId: sale.subAccountId,
          saleId: sale.id,
          installmentId: e.installmentId,
          recipientUserId: e.userId,
          salesRoleId: e.salesRoleId,
          salesRoleVersionId: e.salesRoleVersionId,
          ruleId: null,
          ruleVersionId: null,
          amount: e.amount,
          currency: e.currency,
          status: "pending",
          pendingUntil: e.pendingUntil,
          availableAt: e.availableAt,
          computedFrom: e.computedFrom,
        });
        entryCount++;
        continue;
      }

      await tx
        .insert(schema.commissionEntries)
        .values({
          workspaceId: sale.workspaceId,
          subAccountId: sale.subAccountId,
          saleId: sale.id,
          installmentId: e.installmentId,
          recipientUserId: e.userId,
          salesRoleId: e.salesRoleId,
          salesRoleVersionId: e.salesRoleVersionId,
          ruleId: e.ruleId,
          ruleVersionId: e.ruleVersionId,
          amount: e.amount,
          currency: e.currency,
          status: "pending",
          pendingUntil: e.pendingUntil,
          availableAt: e.availableAt,
          computedFrom: e.computedFrom,
        })
        .onConflictDoUpdate({
          target: [
            schema.commissionEntries.saleId,
            schema.commissionEntries.installmentId,
            schema.commissionEntries.recipientUserId,
            schema.commissionEntries.salesRoleId,
            schema.commissionEntries.ruleId,
          ],
          set: {
            amount: e.amount,
            currency: e.currency,
            pendingUntil: e.pendingUntil,
            availableAt: e.availableAt,
            salesRoleVersionId: e.salesRoleVersionId,
            ruleVersionId: e.ruleVersionId,
            computedFrom: e.computedFrom,
            updatedAt: new Date(),
          },
          // Don't rewrite paid/clawed_back rows.
          setWhere: sql`${schema.commissionEntries.status} IN ('pending', 'available')`,
        });
      entryCount++;
    }

    // 6. Void any existing pending/available entries for this sale that
    // we did NOT produce in this pass.
    const allExisting = await tx
      .select({
        id: schema.commissionEntries.id,
        installmentId: schema.commissionEntries.installmentId,
        recipientUserId: schema.commissionEntries.recipientUserId,
        salesRoleId: schema.commissionEntries.salesRoleId,
        ruleId: schema.commissionEntries.ruleId,
        status: schema.commissionEntries.status,
      })
      .from(schema.commissionEntries)
      .where(
        and(
          eq(schema.commissionEntries.saleId, sale.id),
          sql`${schema.commissionEntries.status} IN ('pending', 'available')`,
        ),
      );

    let voidedCount = 0;
    for (const row of allExisting) {
      const key = `${sale.id}|${row.installmentId ?? "NULL"}|${row.recipientUserId}|${row.salesRoleId ?? "NULL"}|${row.ruleId ?? "NULL"}`;
      if (seenKeys.has(key)) continue;
      await tx
        .update(schema.commissionEntries)
        .set({
          status: "voided",
          canceledAt: new Date(),
          canceledReason: "rule_change_or_installment_terminal",
          updatedAt: new Date(),
        })
        .where(eq(schema.commissionEntries.id, row.id));
      voidedCount++;
    }

    const hash = rulesetHash(matchedRules);

    // 7. Telemetry.
    await tx.insert(schema.commissionRecomputeRuns).values({
      workspaceId: sale.workspaceId,
      saleId: sale.id,
      rulesetHash: hash,
      recipientCount: recipientRows.length,
      entryCount,
      voidedCount,
      durationMs: Date.now() - t0,
      triggeredBy: args.triggeredBy ?? null,
    });

    return {
      saleId: sale.id,
      recipientCount: recipientRows.length,
      entryCount,
      voidedCount,
      rulesetHash: hash,
      durationMs: Date.now() - t0,
    };
  });
}

// Hold-period release sweep. Transitions pending → available for any
// entry whose pendingUntil has elapsed. Returns count of released rows.
export async function releaseAvailableEntries(db: Db, now = new Date()): Promise<number> {
  const released = await db
    .update(schema.commissionEntries)
    .set({ status: "available", updatedAt: new Date() })
    .where(
      and(
        eq(schema.commissionEntries.status, "pending"),
        sql`${schema.commissionEntries.pendingUntil} <= ${now}`,
      ),
    )
    .returning({ id: schema.commissionEntries.id });
  return released.length;
}
