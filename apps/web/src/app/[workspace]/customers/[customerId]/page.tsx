import { notFound } from "next/navigation";
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

const ENTRY_STATUS_VARIANT: Record<string, "info" | "positive" | "won" | "danger" | "neutral"> = {
  pending: "info",
  available: "positive",
  paid: "won",
  clawed_back: "danger",
  voided: "neutral",
};

const DISPOSITION_VARIANT: Record<string, "won" | "objection" | "disqualification" | "neutral"> = {
  won: "won",
  positive: "won",
  objection: "objection",
  disqualification: "disqualification",
  no_show: "neutral",
  rescheduled: "neutral",
  other: "neutral",
};

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ workspace: string; customerId: string }>;
}) {
  const { workspace: slug, customerId } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);

  const detail = await withTenant(ctx.authCtx, (db) =>
    customersDomain.getCustomerDetail(db, {
      customerId,
      workspaceId: ctx.workspace.id,
    }),
  );
  if (!detail) notFound();

  const { customer, sales, calls, entries, facts } = detail;
  const entriesTotal = entries.reduce((acc, e) => acc + Number(e.amount), 0);
  const entriesByStatus = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.status] = (acc[e.status] ?? 0) + Number(e.amount);
    return acc;
  }, {});

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={customer.name || customer.primaryEmail}
        description={
          customer.name
            ? customer.primaryEmail
            : "No name on file — customers get a name on the next sale that includes one."
        }
      />

      {/* Header stats */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Status">
          <Pill variant={STATUS_VARIANT[customer.status] ?? "neutral"}>
            {customer.status.replace("_", " ")}
          </Pill>
        </Stat>
        <Stat label="Lifetime value">
          <Money amount={customer.lifetimeValue} currency={customer.currency} />
        </Stat>
        <Stat label="Sales">
          <span className="text-base text-zinc-100">{sales.length}</span>
        </Stat>
        <Stat label="Customer since">
          <Time value={customer.createdAt} />
        </Stat>
      </section>

      {/* Contact details */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h2 className="mb-2 text-sm font-medium text-zinc-300">Contact</h2>
        <dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          <Detail label="Email">{customer.primaryEmail}</Detail>
          <Detail label="Phone">{customer.phone || "—"}</Detail>
          {customer.attributedSetterUserId && (
            <Detail label="Setter">
              <code className="text-xs text-zinc-300">
                {customer.attributedSetterUserId.slice(0, 8)}
              </code>
            </Detail>
          )}
          {customer.attributedCloserUserId && (
            <Detail label="Closer">
              <code className="text-xs text-zinc-300">
                {customer.attributedCloserUserId.slice(0, 8)}
              </code>
            </Detail>
          )}
          {customer.attributedCxUserId && (
            <Detail label="CX">
              <code className="text-xs text-zinc-300">
                {customer.attributedCxUserId.slice(0, 8)}
              </code>
            </Detail>
          )}
          {customer.churnAt && (
            <Detail label="Churned">
              <Time value={customer.churnAt} />
              {customer.churnReason && (
                <span className="ml-2 text-xs text-zinc-500">{customer.churnReason}</span>
              )}
            </Detail>
          )}
        </dl>
      </section>

      {/* Sales */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">
          Sales · {sales.length}
        </h2>
        {sales.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
            No sales recorded.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
            {sales.map((s) => (
              <li
                key={s.id}
                className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm"
              >
                <a
                  href={`/${slug}/sales/${s.id}`}
                  className="col-span-5 text-zinc-100 hover:text-blue-400"
                >
                  {s.productName || "Sale"}
                </a>
                <span className="col-span-2 text-right text-zinc-100">
                  <Money amount={s.bookedAmount} currency={s.currency} />
                </span>
                <span className="col-span-2 text-right text-zinc-400">
                  <Money amount={s.collectedAmount} currency={s.currency} />
                </span>
                <span className="col-span-2 text-zinc-500">
                  <Time value={s.closedAt} />
                </span>
                <span className="col-span-1 text-right">
                  {s.refundStatus !== "none" ? (
                    <Pill variant="warning">refund</Pill>
                  ) : s.linkedCallId ? (
                    <Pill variant="positive">linked</Pill>
                  ) : (
                    <Pill variant="warning">unlinked</Pill>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Calls */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">
          Calls · {calls.length}
        </h2>
        {calls.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
            No calls logged.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
            {calls.map((c) => (
              <li
                key={c.id}
                className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm"
              >
                <a
                  href={`/${slug}/calls/${c.id}`}
                  className="col-span-4 text-zinc-100 hover:text-blue-400"
                >
                  {c.contactName || c.contactEmail || "Call"}
                </a>
                <span className="col-span-3 text-zinc-500">
                  {c.appointmentAt ? <Time value={c.appointmentAt} /> : "—"}
                </span>
                <span className="col-span-2 text-zinc-500">
                  {c.durationSeconds ? `${Math.round(c.durationSeconds / 60)} min` : "—"}
                </span>
                <span className="col-span-2">
                  {c.dispositionLabel ? (
                    <Pill
                      variant={
                        DISPOSITION_VARIANT[c.dispositionCategory ?? "other"] ?? "neutral"
                      }
                    >
                      {c.dispositionLabel}
                    </Pill>
                  ) : (
                    <span className="text-xs text-zinc-500">no disposition</span>
                  )}
                </span>
                <span className="col-span-1 text-right text-xs text-zinc-500">
                  {c.sourceIntegration && (
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5">
                      {c.sourceIntegration}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Commissions */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">
          Commission ledger · {entries.length} entries · total{" "}
          <Money amount={entriesTotal.toFixed(2)} currency={customer.currency} />
        </h2>
        {entries.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
            No commission entries yet — they materialize after the engine runs on a sale.
          </p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {Object.entries(entriesByStatus).map(([status, amt]) => (
                <span
                  key={status}
                  className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-1 text-xs"
                >
                  <Pill variant={ENTRY_STATUS_VARIANT[status] ?? "neutral"}>
                    {status.replace("_", " ")}
                  </Pill>
                  <Money amount={amt.toFixed(2)} currency={customer.currency} />
                </span>
              ))}
            </div>
            <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
              {entries.slice(0, 30).map((e) => (
                <li
                  key={e.id}
                  className="grid grid-cols-12 items-center gap-3 px-4 py-2 text-sm"
                >
                  <span className="col-span-3 font-mono text-xs text-zinc-500">
                    {e.recipientUserId.slice(0, 8)}
                  </span>
                  <span className="col-span-3 text-zinc-100">
                    <Money amount={e.amount} currency={e.currency} />
                  </span>
                  <span className="col-span-3">
                    <Pill variant={ENTRY_STATUS_VARIANT[e.status] ?? "neutral"}>
                      {e.status.replace("_", " ")}
                    </Pill>
                  </span>
                  <span className="col-span-3 text-right text-xs text-zinc-500">
                    {e.paidAt ? (
                      <>paid <Time value={e.paidAt} /></>
                    ) : e.availableAt ? (
                      <Time value={e.availableAt} />
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            {entries.length > 30 && (
              <p className="mt-2 text-xs text-zinc-500">
                Showing first 30. Open a sale to see its full ledger.
              </p>
            )}
          </>
        )}
      </section>

      {/* Agent memory */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">
          Agent memory · {facts.length} facts
        </h2>
        {facts.length === 0 ? (
          <EmptyState
            title="No facts yet."
            description="Connect Fathom and the agent will start populating facts about this customer from transcripts."
          />
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
            {facts.slice(0, 20).map((f) => (
              <li key={f.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
                <div className="flex items-start gap-3">
                  <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs uppercase tracking-wider text-zinc-400">
                    {f.kind}
                  </span>
                  <p className="flex-1 text-zinc-200">{f.content}</p>
                  {f.confirmedByUserAt && <Pill variant="positive">confirmed</Pill>}
                  {f.contradictedAt && <Pill variant="danger">contradicted</Pill>}
                </div>
                <span className="text-xs text-zinc-500">
                  conf {Number(f.confidence).toFixed(2)} · added <Time value={f.createdAt} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-base text-zinc-100">{children}</p>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-xs uppercase tracking-wider text-zinc-500">
        {label}
      </dt>
      <dd className="flex-1 text-zinc-200">{children}</dd>
    </div>
  );
}
