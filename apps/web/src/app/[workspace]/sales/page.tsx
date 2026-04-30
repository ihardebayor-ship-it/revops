import { withTenant } from "@revops/db/client";
import { sales as salesDomain } from "@revops/domain";
import { EmptyState, Money, PageHeader, Pill, Time } from "@revops/ui";
import { resolveWorkspaceBySlug } from "~/lib/workspace";

export default async function SalesListPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { workspace: slug } = await params;
  const { filter } = await searchParams;
  const onlyUnlinked = filter === "unlinked";
  const ctx = await resolveWorkspaceBySlug(slug);

  const items = ctx.membership.subAccountId
    ? await withTenant(ctx.authCtx, (db) =>
        salesDomain.listSales(db, {
          subAccountId: ctx.membership.subAccountId!,
          onlyUnlinked,
          limit: 50,
        }),
      )
    : [];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Sales"
        description={`Closed-won deals${onlyUnlinked ? " (unlinked only)" : ""}.`}
        actions={
          <a
            href={`/${slug}/sales/new`}
            className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600"
          >
            New sale
          </a>
        }
      />

      <nav className="flex gap-1 border-b border-zinc-800 text-sm">
        <FilterTab href={`/${slug}/sales`} active={!onlyUnlinked}>
          All
        </FilterTab>
        <FilterTab href={`/${slug}/sales?filter=unlinked`} active={onlyUnlinked}>
          Unlinked
        </FilterTab>
      </nav>

      {items.length === 0 ? (
        <EmptyState
          title={onlyUnlinked ? "No unlinked sales." : "No sales yet."}
          description={
            onlyUnlinked
              ? "Every sale is linked to a call. Nice."
              : "Click “New sale” to log a closed-won deal."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">Product</th>
                <th className="px-4 py-2 text-right font-medium">Booked</th>
                <th className="px-4 py-2 text-right font-medium">Collected</th>
                <th className="px-4 py-2 font-medium">Closed</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {items.map((s) => (
                <tr key={s.id} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-3">
                    <a
                      href={`/${slug}/sales/${s.id}`}
                      className="block hover:text-blue-400"
                    >
                      {s.productName || "Sale"}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-100">
                    <Money amount={s.bookedAmount} currency={s.currency} />
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-400">
                    <Money amount={s.collectedAmount} currency={s.currency} />
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    <Time value={s.closedAt} />
                  </td>
                  <td className="px-4 py-3">
                    {s.linkedCallId ? (
                      <Pill variant="positive">Linked</Pill>
                    ) : (
                      <Pill variant="warning">Unlinked</Pill>
                    )}
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
