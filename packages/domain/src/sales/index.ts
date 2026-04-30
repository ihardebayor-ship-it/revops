// Sales domain — Phase 1 M3.
//
// createSale runs as a single transaction:
//   1. Upsert customer (by email, scoped to workspace)
//   2. Insert sale row
//   3. If paymentSchedule.kind === 'plan': insert payment_plans + N
//      payment_plan_installments rows. If 'one_time': synthetic single
//      installment with status="collected" if collectedAmount >= bookedAmount.
//   4. Validate commission_recipients sum to ~1.0 (within rounding tolerance)
//      and insert one row per recipient. Default-derive from
//      sales_role_assignments × role.default_commission_share when input
//      omits recipients.
//   5. Emit "closed" funnel event on the sale.
//   6. (Deferred to M4) Send commission.recompute.requested Inngest event.
//
// Multi-party from the moment the row exists. The commission engine
// (M4) reads commission_recipients to write per-recipient
// commission_entries against installments.

import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";
import { emitFunnelEvent } from "../funnel/emit";
import { upsertCustomerByEmail } from "../customers/index";

export type SaleRecipientInput = {
  userId: string;
  salesRoleId: string;
  sharePct: string; // numeric(5,4) as decimal string, e.g. "0.2000"
};

export type PaymentSchedule =
  | { kind: "one_time"; collectedAmount?: string }
  | {
      kind: "plan";
      installmentFrequency: "weekly" | "biweekly" | "monthly" | "quarterly";
      totalInstallments: number;
      installmentAmount: string;
      firstInstallmentDate: Date;
    };

export type CreateSaleInput = {
  workspaceId: string;
  subAccountId: string;
  customerEmail: string;
  customerName?: string | null;
  customerPhone?: string | null;
  productName?: string | null;
  bookedAmount: string;
  currency?: string;
  closedAt?: Date;
  paymentSchedule?: PaymentSchedule;
  /** When omitted, recipients are derived from sales_role_assignments × the
   *  workspace's role.default_commission_share. */
  recipients?: SaleRecipientInput[];
  linkedCallId?: string | null;
  paymentProcessor?: string | null;
  sourceIntegration?: string | null;
  externalId?: string | null;
  createdBy: string;
};

export type CreateSaleResult = {
  saleId: string;
  customerId: string;
  recipientCount: number;
  installmentCount: number;
  paymentPlanId: string | null;
};

const SHARE_SUM_TOLERANCE = 0.001;

async function deriveRecipients(
  db: Db,
  args: { workspaceId: string; subAccountId: string; closedAt: Date },
): Promise<SaleRecipientInput[]> {
  // Pull each active sales-role assignment for this sub_account and weight
  // by the role's defaultCommissionShare. If multiple users share a role,
  // the role's share splits evenly across them.
  const rows = await db.execute(sql`
    SELECT
      a.user_id,
      a.sales_role_id,
      r.default_commission_share::float AS share
    FROM sales_role_assignments a
    JOIN sales_roles r ON r.id = a.sales_role_id
    WHERE a.sub_account_id = ${args.subAccountId}
      AND a.deleted_at IS NULL
      AND (a.effective_to IS NULL OR a.effective_to > ${args.closedAt.toISOString()})
      AND r.deleted_at IS NULL
  `);
  const list = rows as unknown as Array<{ user_id: string; sales_role_id: string; share: number }>;

  // Group by role to split evenly when N users share a role.
  const byRole = new Map<string, { share: number; userIds: string[] }>();
  for (const row of list) {
    const prev = byRole.get(row.sales_role_id);
    if (prev) {
      prev.userIds.push(row.user_id);
    } else {
      byRole.set(row.sales_role_id, { share: row.share, userIds: [row.user_id] });
    }
  }

  const recipients: SaleRecipientInput[] = [];
  for (const [salesRoleId, info] of byRole) {
    const perUser = info.share / info.userIds.length;
    for (const userId of info.userIds) {
      recipients.push({
        userId,
        salesRoleId,
        sharePct: perUser.toFixed(4),
      });
    }
  }
  return recipients;
}

export async function createSale(db: Db, input: CreateSaleInput): Promise<CreateSaleResult> {
  const closedAt = input.closedAt ?? new Date();
  const currency = input.currency ?? "USD";

  return db.transaction(async (tx) => {
    // 1. Customer upsert
    const customer = await upsertCustomerByEmail(tx, {
      workspaceId: input.workspaceId,
      subAccountId: input.subAccountId,
      primaryEmail: input.customerEmail,
      name: input.customerName ?? null,
      phone: input.customerPhone ?? null,
      createdBy: input.createdBy,
    });

    // 2. Sale row
    const collectedFromOneTime =
      input.paymentSchedule?.kind === "one_time"
        ? (input.paymentSchedule.collectedAmount ?? "0")
        : "0";
    const [sale] = await tx
      .insert(schema.sales)
      .values({
        workspaceId: input.workspaceId,
        subAccountId: input.subAccountId,
        customerId: customer.id,
        linkedCallId: input.linkedCallId ?? null,
        productName: input.productName ?? null,
        bookedAmount: input.bookedAmount,
        collectedAmount: collectedFromOneTime,
        currency,
        closedAt,
        paymentProcessor: input.paymentProcessor ?? null,
        sourceIntegration: input.sourceIntegration ?? null,
        externalId: input.externalId ?? null,
        createdBy: input.createdBy,
      })
      .returning({ id: schema.sales.id });
    if (!sale) throw new Error("Failed to create sale");

    // 3. Payment plan + installments
    let paymentPlanId: string | null = null;
    let installmentCount = 0;
    if (input.paymentSchedule?.kind === "plan") {
      const plan = input.paymentSchedule;
      const [planRow] = await tx
        .insert(schema.paymentPlans)
        .values({
          workspaceId: input.workspaceId,
          subAccountId: input.subAccountId,
          saleId: sale.id,
          customerId: customer.id,
          installmentFrequency: plan.installmentFrequency,
          totalInstallments: plan.totalInstallments,
          installmentAmount: plan.installmentAmount,
          currency,
          firstInstallmentDate: plan.firstInstallmentDate.toISOString().slice(0, 10),
        })
        .returning({ id: schema.paymentPlans.id });
      if (!planRow) throw new Error("Failed to create payment plan");
      paymentPlanId = planRow.id;

      // Materialize each scheduled installment.
      const stepDays =
        plan.installmentFrequency === "weekly"
          ? 7
          : plan.installmentFrequency === "biweekly"
            ? 14
            : plan.installmentFrequency === "monthly"
              ? 30
              : 90;
      for (let i = 0; i < plan.totalInstallments; i++) {
        const expectedDate = new Date(plan.firstInstallmentDate);
        expectedDate.setDate(expectedDate.getDate() + stepDays * i);
        await tx.insert(schema.paymentPlanInstallments).values({
          paymentPlanId: planRow.id,
          saleId: sale.id,
          sequence: i + 1,
          expectedAmount: plan.installmentAmount,
          currency,
          expectedDate: expectedDate.toISOString().slice(0, 10),
          status: "scheduled",
        });
      }
      installmentCount = plan.totalInstallments;
    } else {
      // One-time: synthetic single-installment plan. payment_plans.installment_frequency
      // is NOT NULL but a no-op for a 1-installment plan; default to "monthly".
      const [planRow] = await tx
        .insert(schema.paymentPlans)
        .values({
          workspaceId: input.workspaceId,
          subAccountId: input.subAccountId,
          saleId: sale.id,
          customerId: customer.id,
          installmentFrequency: "monthly",
          totalInstallments: 1,
          installmentAmount: input.bookedAmount,
          currency,
          firstInstallmentDate: closedAt.toISOString().slice(0, 10),
          metadata: { kind: "one_time" },
        })
        .returning({ id: schema.paymentPlans.id });
      if (!planRow) throw new Error("Failed to create one-time payment plan");
      paymentPlanId = planRow.id;

      const fullyCollected = collectedFromOneTime === input.bookedAmount;
      await tx.insert(schema.paymentPlanInstallments).values({
        paymentPlanId: planRow.id,
        saleId: sale.id,
        sequence: 1,
        expectedAmount: input.bookedAmount,
        currency,
        expectedDate: closedAt.toISOString().slice(0, 10),
        status: fullyCollected ? "collected" : "scheduled",
        actualAmount: collectedFromOneTime !== "0" ? collectedFromOneTime : null,
        collectedAt: fullyCollected ? closedAt : null,
      });
      installmentCount = 1;
    }

    // 4. Recipients
    let recipients = input.recipients;
    if (!recipients || recipients.length === 0) {
      recipients = await deriveRecipients(tx, {
        workspaceId: input.workspaceId,
        subAccountId: input.subAccountId,
        closedAt,
      });
    }
    if (recipients.length === 0) {
      throw new Error(
        "Cannot create sale: no commission recipients (no sales_role_assignments active)",
      );
    }
    const sharesSum = recipients.reduce((acc, r) => acc + Number(r.sharePct), 0);
    if (Math.abs(sharesSum - 1) > SHARE_SUM_TOLERANCE) {
      throw new Error(
        `Commission shares must sum to 1.0 (got ${sharesSum.toFixed(4)} across ${recipients.length} recipients)`,
      );
    }

    // Lookup the latest version_id for each role. Without it the engine
    // can't snapshot the role-state used at sale-create time.
    const roleIds = recipients.map((r) => r.salesRoleId);
    const versionRows = await tx
      .select({
        salesRoleId: schema.salesRoleVersions.salesRoleId,
        versionId: schema.salesRoleVersions.id,
        version: schema.salesRoleVersions.version,
      })
      .from(schema.salesRoleVersions)
      .where(inArray(schema.salesRoleVersions.salesRoleId, roleIds))
      .orderBy(desc(schema.salesRoleVersions.version));
    const versionMap = new Map<string, string>();
    for (const v of versionRows) {
      // Drizzle's orderBy desc + first-wins gives us the latest per role.
      if (!versionMap.has(v.salesRoleId)) versionMap.set(v.salesRoleId, v.versionId);
    }

    for (const rcp of recipients) {
      const versionId = versionMap.get(rcp.salesRoleId);
      if (!versionId) {
        throw new Error(`Sales role ${rcp.salesRoleId} has no version row`);
      }
      await tx.insert(schema.commissionRecipients).values({
        workspaceId: input.workspaceId,
        subAccountId: input.subAccountId,
        saleId: sale.id,
        userId: rcp.userId,
        salesRoleId: rcp.salesRoleId,
        salesRoleVersionId: versionId,
        sharePct: rcp.sharePct,
        currency,
        status: "pending",
        createdBy: input.createdBy,
      });
    }

    // 5. Funnel event
    await emitFunnelEvent(tx, {
      workspaceId: input.workspaceId,
      subAccountId: input.subAccountId,
      entityType: "sale",
      entityId: sale.id,
      stageSlug: "closed",
      occurredAt: closedAt,
      actorUserId: input.createdBy,
      meta: { kind: "sale_closed", linkedCallId: input.linkedCallId ?? null },
    });

    // 6. (M4) Inngest commission.recompute.requested goes here.

    return {
      saleId: sale.id,
      customerId: customer.id,
      recipientCount: recipients.length,
      installmentCount,
      paymentPlanId,
    };
  });
}

export async function listSales(
  db: Db,
  filter: { subAccountId: string; onlyUnlinked?: boolean; limit?: number },
) {
  const limit = Math.min(filter.limit ?? 50, 200);
  const conditions = [
    eq(schema.sales.subAccountId, filter.subAccountId),
    isNull(schema.sales.deletedAt),
  ];
  if (filter.onlyUnlinked) conditions.push(isNull(schema.sales.linkedCallId));
  return db
    .select({
      id: schema.sales.id,
      customerId: schema.sales.customerId,
      productName: schema.sales.productName,
      bookedAmount: schema.sales.bookedAmount,
      collectedAmount: schema.sales.collectedAmount,
      currency: schema.sales.currency,
      closedAt: schema.sales.closedAt,
      linkedCallId: schema.sales.linkedCallId,
      refundStatus: schema.sales.refundStatus,
    })
    .from(schema.sales)
    .where(and(...conditions))
    .orderBy(desc(schema.sales.closedAt))
    .limit(limit);
}

export async function getSale(db: Db, args: { saleId: string; workspaceId: string }) {
  const [row] = await db
    .select()
    .from(schema.sales)
    .where(
      and(
        eq(schema.sales.id, args.saleId),
        eq(schema.sales.workspaceId, args.workspaceId),
        isNull(schema.sales.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getSaleRecipients(db: Db, args: { saleId: string }) {
  return db
    .select({
      id: schema.commissionRecipients.id,
      userId: schema.commissionRecipients.userId,
      salesRoleId: schema.commissionRecipients.salesRoleId,
      sharePct: schema.commissionRecipients.sharePct,
      computedAmount: schema.commissionRecipients.computedAmount,
      status: schema.commissionRecipients.status,
    })
    .from(schema.commissionRecipients)
    .where(
      and(
        eq(schema.commissionRecipients.saleId, args.saleId),
        isNull(schema.commissionRecipients.deletedAt),
      ),
    )
    .orderBy(asc(schema.commissionRecipients.createdAt));
}

export async function getSaleInstallments(db: Db, args: { saleId: string }) {
  return db
    .select({
      id: schema.paymentPlanInstallments.id,
      sequence: schema.paymentPlanInstallments.sequence,
      expectedAmount: schema.paymentPlanInstallments.expectedAmount,
      actualAmount: schema.paymentPlanInstallments.actualAmount,
      currency: schema.paymentPlanInstallments.currency,
      expectedDate: schema.paymentPlanInstallments.expectedDate,
      collectedAt: schema.paymentPlanInstallments.collectedAt,
      status: schema.paymentPlanInstallments.status,
    })
    .from(schema.paymentPlanInstallments)
    .where(eq(schema.paymentPlanInstallments.saleId, args.saleId))
    .orderBy(asc(schema.paymentPlanInstallments.sequence));
}

// ─── Linking ─────────────────────────────────────────────────────
export async function linkToCall(
  db: Db,
  args: {
    saleId: string;
    callId: string;
    workspaceId: string;
    subAccountId: string;
    actorUserId: string;
  },
) {
  return db.transaction(async (tx) => {
    const [updatedSale] = await tx
      .update(schema.sales)
      .set({ linkedCallId: args.callId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.sales.id, args.saleId),
          eq(schema.sales.workspaceId, args.workspaceId),
          isNull(schema.sales.deletedAt),
        ),
      )
      .returning({ id: schema.sales.id });
    if (!updatedSale) throw new Error("Sale not found");

    await tx
      .update(schema.calls)
      .set({ linkedSaleId: args.saleId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.calls.id, args.callId),
          eq(schema.calls.workspaceId, args.workspaceId),
          isNull(schema.calls.deletedAt),
        ),
      );

    await emitFunnelEvent(tx, {
      workspaceId: args.workspaceId,
      subAccountId: args.subAccountId,
      entityType: "sale",
      entityId: args.saleId,
      stageSlug: "closed",
      occurredAt: new Date(),
      actorUserId: args.actorUserId,
      meta: { via: "manual_link", callId: args.callId },
    });

    return { saleId: args.saleId, callId: args.callId };
  });
}

export async function unlinkFromCall(
  db: Db,
  args: { saleId: string; workspaceId: string },
) {
  return db.transaction(async (tx) => {
    const [sale] = await tx
      .select({ linkedCallId: schema.sales.linkedCallId })
      .from(schema.sales)
      .where(
        and(
          eq(schema.sales.id, args.saleId),
          eq(schema.sales.workspaceId, args.workspaceId),
        ),
      )
      .limit(1);
    const previousCallId = sale?.linkedCallId ?? null;

    await tx
      .update(schema.sales)
      .set({ linkedCallId: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.sales.id, args.saleId),
          eq(schema.sales.workspaceId, args.workspaceId),
        ),
      );

    if (previousCallId) {
      await tx
        .update(schema.calls)
        .set({ linkedSaleId: null, updatedAt: new Date() })
        .where(
          and(
            eq(schema.calls.id, previousCallId),
            eq(schema.calls.workspaceId, args.workspaceId),
          ),
        );
    }

    return { saleId: args.saleId, previousCallId };
  });
}

export async function softDeleteSale(
  db: Db,
  args: { saleId: string; workspaceId: string },
) {
  const [row] = await db
    .update(schema.sales)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.sales.id, args.saleId),
        eq(schema.sales.workspaceId, args.workspaceId),
        isNull(schema.sales.deletedAt),
      ),
    )
    .returning({ id: schema.sales.id });
  return { deleted: !!row };
}

// Suppress unused-import warning — `isNotNull` reserved for future filter variants.
void isNotNull;
