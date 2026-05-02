import { withTenant } from "@revops/db/client";
import { customers as customersDomain } from "@revops/domain";
import { EmptyState, Money, PageHeader, Pill, Time } from "@revops/ui";
import { resolveWorkspaceBySlug } from "~/lib/workspace";

const STATUS_VARIANT: Record<
  string,
  "info" | "positive" | "won" | "danger" | "neutral" | "warning"
> = {
  active: "positive",
  churned: "danger",
  refunded: "warning",
  won_back: "info",
  paused: "neutral",
};

export default async function CustomersListPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);

  const items = ctx.membership.subAccountId
    ? await withTenant(ctx.authCtx, (db) =>
        customersDomain.listCustomers(db, {
          subAccountId: ctx.membership.subAccountId!,
          limit: 100,
        }),
      )
    : [];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Customers"
        description="Everyone who's bought from you. Click in for the full picture — calls, sales, commissions, agent memory."
      />

      {items.length === 0 ? (
        <EmptyState
          title="No customers yet."
          description="Customers appear here automatically when their first sale is recorded."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">LTV</th>
                <th className="px-4 py-2 text-right font-medium">Sales</th>
                <th className="px-4 py-2 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-3">
                    <a
                      href={`/${slug}/customers/${c.id}`}
                      className="block hover:text-blue-400"
                    >
                      <span className="font-medium text-zinc-100">
                        {c.name || c.primaryEmail}
                      </span>
                      {c.name && (
                        <span className="block text-xs text-zinc-500">{c.primaryEmail}</span>
                      )}
                    </a>
                  </td>
                  <td className="px-4 py-3">
                    <Pill variant={STATUS_VARIANT[c.status] ?? "neutral"}>
                      {c.status.replace("_", " ")}
                    </Pill>
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-100">
                    <Money amount={c.lifetimeValue} currency={c.currency} />
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-400">{c.saleCount}</td>
                  <td className="px-4 py-3 text-zinc-500">
                    {c.lastSaleAt ? <Time value={c.lastSaleAt} /> : "—"}
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
