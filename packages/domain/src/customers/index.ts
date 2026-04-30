// Customers domain — persists post-sale. CX commissions, retention,
// expansion all attach here. Phase 1 M3 ships the upsert path used when
// the first sale of a customer arrives.

import { and, eq } from "drizzle-orm";
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
 * Upsert by (workspace_id, primary_email). Returns the customer's id —
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
        eq(schema.customers.primaryEmail, input.primaryEmail.toLowerCase()),
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
        .where(eq(schema.customers.id, existing[0].id));
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
  args: { customerId: string; workspaceId: string },
) {
  const [row] = await db
    .select()
    .from(schema.customers)
    .where(
      and(
        eq(schema.customers.id, args.customerId),
        eq(schema.customers.workspaceId, args.workspaceId),
      ),
    )
    .limit(1);
  return row ?? null;
}
