// Test-only smoke for the commission ledger. It runs recompute twice for an
// existing sale in the selected workspace/sub-account, verifies explanation
// metadata and idempotency, exercises hold release, and proves terminal paid
// rows are not rewritten. Requires ENABLE_TEST_ENDPOINTS plus superadmin.

import { and, desc, eq, isNull } from "drizzle-orm";
import { bypassRls, schema } from "@revops/db/client";
import { commissions as commissionsDomain } from "@revops/domain";
import { requireTestEndpointAccess } from "../_guard";

type SmokeBody = {
  saleId?: string;
};

type EntrySnapshot = {
  id: string;
  amount: string;
  status: string;
  pendingUntil: Date | null;
  availableAt: Date | null;
  paidAt: Date | null;
  clawedBackAt: Date | null;
  canceledAt: Date | null;
  canceledReason: string | null;
  computedFrom: Record<string, unknown>;
};

export async function POST(req: Request) {
  const access = await requireTestEndpointAccess();
  if (access instanceof Response) return access;

  const workspaceId = req.headers.get("x-workspace-id");
  const subAccountId = req.headers.get("x-sub-account-id");
  if (!workspaceId || !subAccountId) {
    return new Response("x-workspace-id and x-sub-account-id required", { status: 400 });
  }

  const body = await readBody(req);
  const saleId = await resolveSaleId({ workspaceId, subAccountId, saleId: body.saleId });
  if (!saleId) {
    return Response.json(
      {
        ok: false,
        reason: "no_sale",
        message: "Create a sale in this sub-account before running the commission ledger smoke.",
      },
      { status: 409 },
    );
  }

  const preflight = await bypassRls(async (db) => {
    const [recipientCount, installmentCount] = await Promise.all([
      db
        .select({ id: schema.commissionRecipients.id })
        .from(schema.commissionRecipients)
        .where(
          and(
            eq(schema.commissionRecipients.saleId, saleId),
            isNull(schema.commissionRecipients.deletedAt),
          ),
        ),
      db
        .select({ id: schema.paymentPlanInstallments.id })
        .from(schema.paymentPlanInstallments)
        .where(eq(schema.paymentPlanInstallments.saleId, saleId)),
    ]);
    return { recipientCount: recipientCount.length, installmentCount: installmentCount.length };
  });
  if (preflight.recipientCount === 0 || preflight.installmentCount === 0) {
    return Response.json(
      {
        ok: false,
        saleId,
        reason: "sale_not_commission_ready",
        preflight,
      },
      { status: 409 },
    );
  }

  const first = await bypassRls((db) =>
    commissionsDomain.recomputeCommissionsForSale(db, {
      saleId,
      triggeredBy: "test.commission-ledger-smoke.first",
    }),
  );
  if (first.entryCount === 0) throw new Error("Commission recompute produced no entries");

  const afterFirst = await listEntries(saleId);
  assertExplanations(afterFirst);

  const second = await bypassRls((db) =>
    commissionsDomain.recomputeCommissionsForSale(db, {
      saleId,
      triggeredBy: "test.commission-ledger-smoke.second",
    }),
  );
  const afterSecond = await listEntries(saleId);
  if (activeEntryCount(afterSecond) !== activeEntryCount(afterFirst)) {
    throw new Error("Commission recompute was not idempotent by active entry count");
  }
  assertExplanations(afterSecond);

  const releaseCheck = await exerciseRelease(afterSecond);
  const terminalCheck = await exercisePaidLock(saleId, afterSecond);

  return Response.json({
    ok: true,
    saleId,
    preflight,
    first,
    second,
    checks: {
      explanations: true,
      idempotentActiveEntryCount: true,
      release: releaseCheck,
      paidLock: terminalCheck,
    },
  });
}

async function readBody(req: Request): Promise<SmokeBody> {
  try {
    return (await req.json()) as SmokeBody;
  } catch {
    return {};
  }
}

async function resolveSaleId(input: {
  workspaceId: string;
  subAccountId: string;
  saleId?: string;
}): Promise<string | null> {
  return bypassRls(async (db) => {
    const conditions = [
      eq(schema.sales.workspaceId, input.workspaceId),
      eq(schema.sales.subAccountId, input.subAccountId),
      isNull(schema.sales.deletedAt),
    ];
    if (input.saleId) conditions.push(eq(schema.sales.id, input.saleId));

    const [sale] = await db
      .select({ id: schema.sales.id })
      .from(schema.sales)
      .where(and(...conditions))
      .orderBy(desc(schema.sales.closedAt))
      .limit(1);
    return sale?.id ?? null;
  });
}

async function listEntries(saleId: string): Promise<EntrySnapshot[]> {
  return bypassRls((db) =>
    db
      .select({
        id: schema.commissionEntries.id,
        amount: schema.commissionEntries.amount,
        status: schema.commissionEntries.status,
        pendingUntil: schema.commissionEntries.pendingUntil,
        availableAt: schema.commissionEntries.availableAt,
        paidAt: schema.commissionEntries.paidAt,
        clawedBackAt: schema.commissionEntries.clawedBackAt,
        canceledAt: schema.commissionEntries.canceledAt,
        canceledReason: schema.commissionEntries.canceledReason,
        computedFrom: schema.commissionEntries.computedFrom,
      })
      .from(schema.commissionEntries)
      .where(eq(schema.commissionEntries.saleId, saleId)),
  );
}

async function exerciseRelease(entries: EntrySnapshot[]) {
  const candidate =
    entries.find((entry) => entry.status === "pending") ??
    entries.find((entry) => entry.status === "available");
  if (!candidate) throw new Error("No commission entry available for release smoke");

  const original = snapshot(candidate);
  const past = new Date(Date.now() - 60_000);
  await bypassRls(async (db) => {
    await db
      .update(schema.commissionEntries)
      .set({
        status: "pending",
        pendingUntil: past,
        availableAt: past,
        updatedAt: new Date(),
      })
      .where(eq(schema.commissionEntries.id, candidate.id));
  });

  const released = await bypassRls((db) => commissionsDomain.releaseAvailableEntries(db));
  const [after] = await listEntriesById(candidate.id);
  const passed = after?.status === "available";

  await restoreEntry(candidate.id, original);
  if (!passed) throw new Error("Commission release smoke did not mark the entry available");

  return { entryId: candidate.id, released };
}

async function exercisePaidLock(saleId: string, entries: EntrySnapshot[]) {
  const candidate = entries.find(
    (entry) => entry.status === "pending" || entry.status === "available",
  );
  if (!candidate) throw new Error("No commission entry available for paid-lock smoke");

  const original = snapshot(candidate);
  await bypassRls(async (db) => {
    await db
      .update(schema.commissionEntries)
      .set({ status: "paid", amount: "0.01", paidAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.commissionEntries.id, candidate.id));
  });

  await bypassRls((db) =>
    commissionsDomain.recomputeCommissionsForSale(db, {
      saleId,
      triggeredBy: "test.commission-ledger-smoke.paid-lock",
    }),
  );

  const [after] = await listEntriesById(candidate.id);
  const passed = after?.status === "paid" && after.amount === "0.01";

  await restoreEntry(candidate.id, original);
  if (!passed) throw new Error("Paid commission entry was rewritten during recompute");

  return { entryId: candidate.id };
}

async function listEntriesById(entryId: string): Promise<EntrySnapshot[]> {
  return bypassRls((db) =>
    db
      .select({
        id: schema.commissionEntries.id,
        amount: schema.commissionEntries.amount,
        status: schema.commissionEntries.status,
        pendingUntil: schema.commissionEntries.pendingUntil,
        availableAt: schema.commissionEntries.availableAt,
        paidAt: schema.commissionEntries.paidAt,
        clawedBackAt: schema.commissionEntries.clawedBackAt,
        canceledAt: schema.commissionEntries.canceledAt,
        canceledReason: schema.commissionEntries.canceledReason,
        computedFrom: schema.commissionEntries.computedFrom,
      })
      .from(schema.commissionEntries)
      .where(eq(schema.commissionEntries.id, entryId))
      .limit(1),
  );
}

function snapshot(entry: EntrySnapshot) {
  return {
    amount: entry.amount,
    status: entry.status,
    pendingUntil: entry.pendingUntil,
    availableAt: entry.availableAt,
    paidAt: entry.paidAt,
    clawedBackAt: entry.clawedBackAt,
    canceledAt: entry.canceledAt,
    canceledReason: entry.canceledReason,
  };
}

async function restoreEntry(entryId: string, original: ReturnType<typeof snapshot>): Promise<void> {
  await bypassRls(async (db) => {
    await db
      .update(schema.commissionEntries)
      .set({
        amount: original.amount,
        status: original.status as never,
        pendingUntil: original.pendingUntil,
        availableAt: original.availableAt,
        paidAt: original.paidAt,
        clawedBackAt: original.clawedBackAt,
        canceledAt: original.canceledAt,
        canceledReason: original.canceledReason,
        updatedAt: new Date(),
      })
      .where(eq(schema.commissionEntries.id, entryId));
  });
}

function assertExplanations(entries: EntrySnapshot[]) {
  const active = entries.filter((entry) => entry.status !== "voided");
  if (active.length === 0) throw new Error("No active commission entries found");

  for (const entry of active) {
    const explanation = entry.computedFrom.explanation;
    if (!explanation || typeof explanation !== "object") {
      throw new Error(`Commission entry ${entry.id} has no explanation metadata`);
    }
  }
}

function activeEntryCount(entries: EntrySnapshot[]) {
  return entries.filter((entry) => entry.status !== "voided").length;
}
