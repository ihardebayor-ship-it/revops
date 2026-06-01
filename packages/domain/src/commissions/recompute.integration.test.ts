import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { bypassRls, schema } from "@revops/db/client";
import { recomputeCommissionsForSale } from "./recompute";

const describeDb = process.env.RUN_DB_INTEGRATION_TESTS === "1" ? describe : describe.skip;
const dbTestTimeoutMs = 60_000;

type Fixture = {
  userIds: string[];
  workspaceId: string;
  subAccountId: string;
  saleId: string;
  installmentId: string;
  salesRoleId: string;
  ruleId: string | null;
};

const fixtures: Fixture[] = [];

describeDb("commission recompute integration", () => {
  afterEach(async () => {
    await cleanupFixtures();
  });

  it(
    "is idempotent and persists explanation metadata",
    async () => {
      const fixture = await createCommissionFixture({ recipientCount: 1, createRule: true });

      const first = await bypassRls((db) =>
        recomputeCommissionsForSale(db, {
          saleId: fixture.saleId,
          triggeredBy: "test.integration.first",
        }),
      );
      const afterFirst = await listEntries(fixture.saleId);

      const second = await bypassRls((db) =>
        recomputeCommissionsForSale(db, {
          saleId: fixture.saleId,
          triggeredBy: "test.integration.second",
        }),
      );
      const afterSecond = await listEntries(fixture.saleId);

      expect(first.entryCount).toBe(1);
      expect(second.entryCount).toBe(1);
      expect(afterFirst).toHaveLength(1);
      expect(afterSecond).toHaveLength(1);
      expect(afterSecond[0]?.id).toBe(afterFirst[0]?.id);
      expect(afterSecond[0]?.computedFrom.explanation).toMatchObject({
        matchedRule: { ruleId: fixture.ruleId, paidOn: "collected", holdDays: 0 },
        amount: { computedAmount: "100.00", baseSource: "actual_amount" },
        recipient: { source: "integration_test" },
      });
    },
    dbTestTimeoutMs,
  );

  it(
    "does not rewrite paid rows and only voids pending or available rows",
    async () => {
      const fixture = await createCommissionFixture({ recipientCount: 2, createRule: true });
      await bypassRls((db) =>
        recomputeCommissionsForSale(db, {
          saleId: fixture.saleId,
          triggeredBy: "test.integration.initial",
        }),
      );
      const [paidCandidate, pendingCandidate] = await listEntries(fixture.saleId);
      expect(paidCandidate).toBeDefined();
      expect(pendingCandidate).toBeDefined();

      await markEntryPaid(paidCandidate!.id);
      await bypassRls((db) =>
        recomputeCommissionsForSale(db, {
          saleId: fixture.saleId,
          triggeredBy: "test.integration.paid-lock",
        }),
      );

      const afterPaidLock = await listEntries(fixture.saleId);
      expect(afterPaidLock.find((entry) => entry.id === paidCandidate!.id)).toMatchObject({
        amount: "0.01",
        status: "paid",
      });

      await markInstallmentFailed(fixture.installmentId);
      const terminalRun = await bypassRls((db) =>
        recomputeCommissionsForSale(db, {
          saleId: fixture.saleId,
          triggeredBy: "test.integration.terminal-installment",
        }),
      );
      const afterTerminal = await listEntries(fixture.saleId);

      expect(terminalRun.entryCount).toBe(0);
      expect(terminalRun.voidedCount).toBe(1);
      expect(afterTerminal.find((entry) => entry.id === paidCandidate!.id)).toMatchObject({
        amount: "0.01",
        status: "paid",
      });
      expect(afterTerminal.find((entry) => entry.id === pendingCandidate!.id)).toMatchObject({
        status: "voided",
        canceledReason: "rule_change_or_installment_terminal",
      });
    },
    dbTestTimeoutMs,
  );

  it(
    "does not duplicate terminal rows when the matched rule is null",
    async () => {
      const fixture = await createCommissionFixture({ recipientCount: 1, createRule: false });
      await bypassRls((db) =>
        recomputeCommissionsForSale(db, {
          saleId: fixture.saleId,
          triggeredBy: "test.integration.null-rule-initial",
        }),
      );
      const [entry] = await listEntries(fixture.saleId);
      expect(entry).toMatchObject({ ruleId: null, status: "pending" });

      await markEntryPaid(entry!.id);
      await bypassRls((db) =>
        recomputeCommissionsForSale(db, {
          saleId: fixture.saleId,
          triggeredBy: "test.integration.null-rule-paid-lock",
        }),
      );
      const afterPaidLock = await listEntries(fixture.saleId);

      expect(afterPaidLock).toHaveLength(1);
      expect(afterPaidLock[0]).toMatchObject({
        id: entry!.id,
        amount: "0.01",
        ruleId: null,
        status: "paid",
      });
    },
    dbTestTimeoutMs,
  );
});

async function createCommissionFixture(input: {
  recipientCount: 1 | 2;
  createRule: boolean;
}): Promise<Fixture> {
  const runId = randomUUID();
  const userIds = Array.from(
    { length: input.recipientCount },
    (_, index) => `it-commission-${runId}-${index}`,
  );

  const fixture = await bypassRls(async (db) => {
    await db.insert(schema.user).values(
      userIds.map((id, index) => ({
        id,
        name: `Commission Integration ${index}`,
        email: `${id}@example.test`,
        emailVerified: true,
      })),
    );

    const [workspace] = await db
      .insert(schema.workspaces)
      .values({
        name: `Commission Integration ${runId}`,
        slug: `commission-it-${runId}`,
        topologyPreset: "solo",
      })
      .returning({ id: schema.workspaces.id });
    const [subAccount] = await db
      .insert(schema.subAccounts)
      .values({
        workspaceId: workspace!.id,
        name: "Main",
        slug: "main",
      })
      .returning({ id: schema.subAccounts.id });
    const [salesRole] = await db
      .insert(schema.salesRoles)
      .values({
        workspaceId: workspace!.id,
        slug: "closer",
        label: "Closer",
        defaultCommissionShare: "1.0000",
      })
      .returning({ id: schema.salesRoles.id });
    const [salesRoleVersion] = await db
      .insert(schema.salesRoleVersions)
      .values({
        salesRoleId: salesRole!.id,
        version: 1,
        snapshot: {
          slug: "closer",
          label: "Closer",
          stageOwnership: [],
          defaultCommissionShare: "1.0000",
          defaultSlaSeconds: null,
        },
      })
      .returning({ id: schema.salesRoleVersions.id });
    const [sale] = await db
      .insert(schema.sales)
      .values({
        workspaceId: workspace!.id,
        subAccountId: subAccount!.id,
        productName: "Integration Product",
        bookedAmount: "100.00",
        collectedAmount: "100.00",
        currency: "USD",
        closedAt: new Date("2025-01-15T12:00:00Z"),
        sourceIntegration: "integration_test",
      })
      .returning({ id: schema.sales.id });
    const [paymentPlan] = await db
      .insert(schema.paymentPlans)
      .values({
        workspaceId: workspace!.id,
        subAccountId: subAccount!.id,
        saleId: sale!.id,
        installmentFrequency: "one_time",
        totalInstallments: 1,
        installmentAmount: "100.00",
        currency: "USD",
        firstInstallmentDate: "2025-01-15",
      })
      .returning({ id: schema.paymentPlans.id });
    const [installment] = await db
      .insert(schema.paymentPlanInstallments)
      .values({
        paymentPlanId: paymentPlan!.id,
        saleId: sale!.id,
        sequence: 1,
        expectedAmount: "100.00",
        actualAmount: "100.00",
        currency: "USD",
        expectedDate: "2025-01-15",
        collectedAt: new Date("2025-01-15T12:00:00Z"),
        status: "collected",
      })
      .returning({ id: schema.paymentPlanInstallments.id });

    for (const userId of userIds) {
      await db.insert(schema.commissionRecipients).values({
        workspaceId: workspace!.id,
        subAccountId: subAccount!.id,
        saleId: sale!.id,
        userId,
        salesRoleId: salesRole!.id,
        salesRoleVersionId: salesRoleVersion!.id,
        sharePct: input.recipientCount === 1 ? "1.0000" : "0.5000",
        currency: "USD",
        metadata: { source: "integration_test" },
      });
    }

    let ruleId: string | null = null;
    if (input.createRule) {
      const [rule] = await db
        .insert(schema.commissionRules)
        .values({
          workspaceId: workspace!.id,
          name: "Integration Rule",
          type: "flat_rate",
          salesRoleId: salesRole!.id,
          sharePct: "1.0000",
          currency: "USD",
          productMatch: { kind: "any" },
          sourceMatch: { kind: "any" },
          holdDays: 0,
          paidOn: "collected",
          isActive: 1,
        })
        .returning({ id: schema.commissionRules.id });
      ruleId = rule!.id;
    }

    return {
      userIds,
      workspaceId: workspace!.id,
      subAccountId: subAccount!.id,
      saleId: sale!.id,
      installmentId: installment!.id,
      salesRoleId: salesRole!.id,
      ruleId,
    };
  });

  fixtures.push(fixture);
  return fixture;
}

async function listEntries(saleId: string) {
  return bypassRls((db) =>
    db
      .select({
        id: schema.commissionEntries.id,
        amount: schema.commissionEntries.amount,
        status: schema.commissionEntries.status,
        ruleId: schema.commissionEntries.ruleId,
        canceledReason: schema.commissionEntries.canceledReason,
        computedFrom: schema.commissionEntries.computedFrom,
      })
      .from(schema.commissionEntries)
      .where(eq(schema.commissionEntries.saleId, saleId))
      .orderBy(schema.commissionEntries.recipientUserId),
  );
}

async function markEntryPaid(entryId: string): Promise<void> {
  await bypassRls(async (db) => {
    await db
      .update(schema.commissionEntries)
      .set({ status: "paid", amount: "0.01", paidAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.commissionEntries.id, entryId));
  });
}

async function markInstallmentFailed(installmentId: string): Promise<void> {
  await bypassRls(async (db) => {
    await db
      .update(schema.paymentPlanInstallments)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(schema.paymentPlanInstallments.id, installmentId));
  });
}

async function cleanupFixtures(): Promise<void> {
  const pending = fixtures.splice(0);
  if (pending.length === 0) return;

  await bypassRls(async (db) => {
    for (const fixture of pending.reverse()) {
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, fixture.workspaceId));
      await db.delete(schema.user).where(inArray(schema.user.id, fixture.userIds));
    }
  });
}
