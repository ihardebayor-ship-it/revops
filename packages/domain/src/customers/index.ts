// Customers domain — persists post-sale. CX commissions, retention,
// expansion all attach here. Phase 1 M3 ships the upsert path used when
// the first sale of a customer arrives.

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";

export type UpsertCustomerInput = {
  workspaceId: string;
  subAccountId: string;
  primaryEmail: string;
  name?: string | null;
  phone?: string | null;
  createdBy?: string | null;
};

/**
 * Upsert by (sub_account_id, primary_email). Returns the customer's id —
 * either the existing one or the newly inserted one. Updates name/phone
 * if the upsert input provides values and the row currently has nulls
 * (don't overwrite explicit edits).
 */
export async function upsertCustomerByEmail(
  db: Db,
  input: UpsertCustomerInput,
): Promise<{ id: string; created: boolean }> {
  const existing = await db
    .select({
      id: schema.customers.id,
      name: schema.customers.name,
      phone: schema.customers.phone,
    })
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.workspaceId, input.workspaceId),
        eq(schema.customers.subAccountId, input.subAccountId),
        eq(schema.customers.primaryEmail, input.primaryEmail.toLowerCase()),
        isNull(schema.customers.deletedAt),
      ),
    )
    .limit(1);

  if (existing[0]) {
    const patch: Record<string, unknown> = {};
    if (input.name && !existing[0].name) patch.name = input.name;
    if (input.phone && !existing[0].phone) patch.phone = input.phone;
    if (Object.keys(patch).length > 0) {
      await db
        .update(schema.customers)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(schema.customers.id, existing[0].id),
            eq(schema.customers.workspaceId, input.workspaceId),
            eq(schema.customers.subAccountId, input.subAccountId),
            isNull(schema.customers.deletedAt),
          ),
        );
    }
    return { id: existing[0].id, created: false };
  }

  const [row] = await db
    .insert(schema.customers)
    .values({
      workspaceId: input.workspaceId,
      subAccountId: input.subAccountId,
      primaryEmail: input.primaryEmail.toLowerCase(),
      name: input.name ?? null,
      phone: input.phone ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: schema.customers.id });
  if (!row) throw new Error("Failed to create customer");
  return { id: row.id, created: true };
}

export async function getCustomer(
  db: Db,
  args: { customerId: string; workspaceId: string; subAccountId: string },
) {
  const [row] = await db
    .select()
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.id, args.customerId),
        eq(schema.customers.workspaceId, args.workspaceId),
        eq(schema.customers.subAccountId, args.subAccountId),
        isNull(schema.customers.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type CustomerListItem = {
  id: string;
  primaryEmail: string;
  name: string | null;
  status: string;
  lifetimeValue: string;
  currency: string;
  createdAt: Date;
  saleCount: number;
  lastSaleAt: Date | null;
};

/**
 * List customers in a sub-account with rolled-up sale counts + last-sale
 * timestamps. Ordered most-recent activity first (last sale, falling back
 * to creation date for customers with no sales yet).
 */
export async function listCustomers(
  db: Db,
  args: { subAccountId: string; limit?: number },
): Promise<CustomerListItem[]> {
  const limit = Math.min(args.limit ?? 50, 200);
  const rows = await db
    .select({
      id: schema.customers.id,
      primaryEmail: schema.customers.primaryEmail,
      name: schema.customers.name,
      status: schema.customers.status,
      lifetimeValue: schema.customers.lifetimeValue,
      currency: schema.customers.currency,
      createdAt: schema.customers.createdAt,
      saleCount: sql<number>`count(${schema.sales.id})::int`,
      lastSaleAt: sql<Date | null>`max(${schema.sales.closedAt})`,
    })
    .from(schema.customers)
    .leftJoin(
      schema.sales,
      and(eq(schema.sales.customerId, schema.customers.id), isNull(schema.sales.deletedAt)),
    )
    .where(
      and(eq(schema.customers.subAccountId, args.subAccountId), isNull(schema.customers.deletedAt)),
    )
    .groupBy(schema.customers.id)
    .orderBy(sql`coalesce(max(${schema.sales.closedAt}), ${schema.customers.createdAt}) desc`)
    .limit(limit);
  return rows;
}

/**
 * Aggregated detail view for a single customer: header + sales + calls
 * + commission entries across those sales + agent_facts scoped to this
 * customer. Caller passes workspaceId/subAccountId so the row is scoped.
 */
export async function getCustomerDetail(
  db: Db,
  args: { customerId: string; workspaceId: string; subAccountId: string },
) {
  const customer = await getCustomer(db, args);
  if (!customer) return null;

  const [sales, calls, entries, facts] = await Promise.all([
    db
      .select({
        id: schema.sales.id,
        productName: schema.sales.productName,
        bookedAmount: schema.sales.bookedAmount,
        collectedAmount: schema.sales.collectedAmount,
        currency: schema.sales.currency,
        closedAt: schema.sales.closedAt,
        linkedCallId: schema.sales.linkedCallId,
        refundStatus: schema.sales.refundStatus,
        refundedAmount: schema.sales.refundedAmount,
      })
      .from(schema.sales)
      .where(
        and(
          eq(schema.sales.customerId, args.customerId),
          eq(schema.sales.workspaceId, args.workspaceId),
          eq(schema.sales.subAccountId, args.subAccountId),
          isNull(schema.sales.deletedAt),
        ),
      )
      .orderBy(desc(schema.sales.closedAt)),
    db
      .select({
        id: schema.calls.id,
        appointmentAt: schema.calls.appointmentAt,
        completedAt: schema.calls.completedAt,
        durationSeconds: schema.calls.durationSeconds,
        contactName: schema.calls.contactName,
        contactEmail: schema.calls.contactEmail,
        dispositionId: schema.calls.dispositionId,
        dispositionLabel: schema.dispositions.label,
        dispositionCategory: schema.dispositions.category,
        sourceIntegration: schema.calls.sourceIntegration,
        recordingUrl: schema.calls.recordingUrl,
      })
      .from(schema.calls)
      .leftJoin(schema.dispositions, eq(schema.dispositions.id, schema.calls.dispositionId))
      .where(
        and(
          eq(schema.calls.customerId, args.customerId),
          eq(schema.calls.workspaceId, args.workspaceId),
          eq(schema.calls.subAccountId, args.subAccountId),
          isNull(schema.calls.deletedAt),
        ),
      )
      .orderBy(desc(schema.calls.appointmentAt)),
    db
      .select({
        id: schema.commissionEntries.id,
        saleId: schema.commissionEntries.saleId,
        recipientUserId: schema.commissionEntries.recipientUserId,
        amount: schema.commissionEntries.amount,
        currency: schema.commissionEntries.currency,
        status: schema.commissionEntries.status,
        availableAt: schema.commissionEntries.availableAt,
        paidAt: schema.commissionEntries.paidAt,
      })
      .from(schema.commissionEntries)
      .innerJoin(schema.sales, eq(schema.sales.id, schema.commissionEntries.saleId))
      .where(
        and(
          eq(schema.sales.customerId, args.customerId),
          eq(schema.sales.workspaceId, args.workspaceId),
          eq(schema.sales.subAccountId, args.subAccountId),
          eq(schema.commissionEntries.subAccountId, args.subAccountId),
        ),
      )
      .orderBy(asc(schema.commissionEntries.availableAt)),
    db
      .select({
        id: schema.agentFacts.id,
        kind: schema.agentFacts.kind,
        content: schema.agentFacts.content,
        confidence: schema.agentFacts.confidence,
        confirmedByUserAt: schema.agentFacts.confirmedByUserAt,
        contradictedAt: schema.agentFacts.contradictedAt,
        createdAt: schema.agentFacts.createdAt,
      })
      .from(schema.agentFacts)
      .where(
        and(
          eq(schema.agentFacts.workspaceId, args.workspaceId),
          eq(schema.agentFacts.scope, "customer"),
          eq(schema.agentFacts.scopeRefId, args.customerId),
        ),
      )
      .orderBy(desc(schema.agentFacts.createdAt))
      .limit(50),
  ]);

  return { customer, sales, calls, entries, facts };
}
