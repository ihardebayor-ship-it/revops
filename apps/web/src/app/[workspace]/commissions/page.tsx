import { and, desc, eq, sql } from "drizzle-orm";
import { withTenant, schema } from "@revops/db/client";
import { EmptyState, Money, PageHeader, Pill, Time } from "@revops/ui";
import { resolveWorkspaceBySlug } from "~/lib/workspace";

const STATUS_VARIANT: Record<string, "info" | "positive" | "won" | "danger" | "neutral"> = {
  pending: "info",
  available: "positive",
  paid: "won",
  clawed_back: "danger",
  voided: "neutral",
};

export default async function CommissionsListPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { workspace: slug } = await params;
  const { status } = await searchParams;
  const ctx = await resolveWorkspaceBySlug(slug);

  const result = await withTenant(ctx.authCtx, async (db) => {
    const conditions = [
      eq(schema.commissionEntries.workspaceId, ctx.workspace.id),
      eq(schema.commissionEntries.recipientUserId, ctx.authCtx.userId),
    ];
    if (status) conditions.push(eq(schema.commissionEntries.status, status as never));

    const [rows, summaryRows] = await Promise.all([
      db
        .select({
          id: schema.commissionEntries.id,
          saleId: schema.commissionEntries.saleId,
          installmentId: schema.commissionEntries.installmentId,
          amount: schema.commissionEntries.amount,
          currency: schema.commissionEntries.currency,
          status: schema.commissionEntries.status,
          pendingUntil: schema.commissionEntries.pendingUntil,
          availableAt: schema.commissionEntries.availableAt,
          paidAt: schema.commissionEntries.paidAt,
          clawedBackAt: schema.commissionEntries.clawedBackAt,
          createdAt: schema.commissionEntries.createdAt,
          productName: schema.sales.productName,
        })
        .from(schema.commissionEntries)
        .leftJoin(schema.sales, eq(schema.sales.id, schema.commissionEntries.saleId))
        .where(and(...conditions))
        .orderBy(desc(schema.commissionEntries.availableAt))
        .limit(200),
      db
        .select({
          status: schema.commissionEntries.status,
          total: sql<string>`coalesce(sum(${schema.commissionEntries.amount}), 0)`,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.commissionEntries)
        .where(
          and(
            eq(schema.commissionEntries.workspaceId, ctx.workspace.id),
            eq(schema.commissionEntries.recipientUserId, ctx.authCtx.userId),
          ),
        )
        .groupBy(schema.commissionEntries.status),
    ]);

    return { rows, summary: summaryRows };
  });

  const summary: Record<string, { total: string; count: number }> = {};
  for (const r of result.summary) summary[r.status] = { total: r.total, count: r.count };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="My commissions"
        description="Per-installment ledger. Hold periods elapse and entries become available, then paid."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Pending" value={summary.pending} variant="info" />
        <SummaryCard label="Available" value={summary.available} variant="positive" />
        <SummaryCard label="Paid" value={summary.paid} variant="won" />
        <SummaryCard label="Clawed back" value={summary.clawed_back} variant="danger" />
      </div>

      <nav className="flex gap-1 border-b border-zinc-800 text-sm">
        <FilterTab href={`/${slug}/commissions`} active={!status}>
          All
        </FilterTab>
        <FilterTab href={`/${slug}/commissions?status=pending`} active={status === "pending"}>
          Pending
        </FilterTab>
        <FilterTab href={`/${slug}/commissions?status=available`} active={status === "available"}>
          Available
        </FilterTab>
        <FilterTab href={`/${slug}/commissions?status=paid`} active={status === "paid"}>
          Paid
        </FilterTab>
      </nav>

      {result.rows.length === 0 ? (
        <EmptyState
          title="No commission entries yet."
          description="Log a sale to start the ledger. Entries materialize once the engine runs."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">Sale</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Available</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {result.rows.map((r) => (
                <tr key={r.id} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-3">
                    <a
                      href={`/${slug}/sales/${r.saleId}`}
                      className="block hover:text-blue-400"
                    >
                      {r.productName || "Sale"}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-100">
                    <Money amount={r.amount} currency={r.currency} />
                  </td>
                  <td className="px-4 py-3">
                    <Pill variant={STATUS_VARIANT[r.status] ?? "neutral"}>
                      {r.status.replace("_", " ")}
                    </Pill>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {r.availableAt ? <Time value={r.availableAt} /> : "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-500">
                    <Time value={r.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  variant,
}: {
  label: string;
  value: { total: string; count: number } | undefined;
  variant: "info" | "positive" | "won" | "danger";
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <Pill variant={variant}>{label}</Pill>
      <p className="mt-2 text-2xl font-semibold text-zinc-100">
        <Money amount={value?.total ?? "0"} currency="USD" />
      </p>
      <p className="mt-1 text-xs text-zinc-500">{value?.count ?? 0} entries</p>
    </div>
  );
}

function FilterTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={`border-b-2 px-4 py-2 ${active ? "border-blue-500 text-zinc-100" : "border-transparent text-zinc-400 hover:text-zinc-100"}`}
    >
      {children}
    </a>
  );
}
