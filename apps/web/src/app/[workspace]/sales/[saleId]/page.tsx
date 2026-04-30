import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { withTenant, schema } from "@revops/db/client";
import { sales as salesDomain, reconciliation as reconDomain } from "@revops/domain";
import { Money, PageHeader, Pill, Time } from "@revops/ui";
import { resolveWorkspaceBySlug } from "~/lib/workspace";
import { LinkerCard } from "./linker-card";

export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ workspace: string; saleId: string }>;
}) {
  const { workspace: slug, saleId } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);

  const detail = await withTenant(ctx.authCtx, async (db) => {
    const sale = await salesDomain.getSale(db, { saleId, workspaceId: ctx.workspace.id });
    if (!sale) return null;
    const [recipients, installments] = await Promise.all([
      salesDomain.getSaleRecipients(db, { saleId }),
      salesDomain.getSaleInstallments(db, { saleId }),
    ]);
    const customer = sale.customerId
      ? (
          await db
            .select({
              id: schema.customers.id,
              email: schema.customers.primaryEmail,
              name: schema.customers.name,
            })
            .from(schema.customers)
            .where(eq(schema.customers.id, sale.customerId))
            .limit(1)
        )[0] ?? null
      : null;

    const suggestions = sale.linkedCallId
      ? []
      : await reconDomain.suggestLinksForSale(db, {
          saleId,
          workspaceId: ctx.workspace.id,
          limit: 5,
        });

    const linkedCall = sale.linkedCallId
      ? (
          await db
            .select({
              id: schema.calls.id,
              contactName: schema.calls.contactName,
              contactEmail: schema.calls.contactEmail,
              appointmentAt: schema.calls.appointmentAt,
            })
            .from(schema.calls)
            .where(eq(schema.calls.id, sale.linkedCallId))
            .limit(1)
        )[0] ?? null
      : null;

    return { sale, recipients, installments, customer, suggestions, linkedCall };
  });

  if (!detail) notFound();

  const { sale, recipients, installments, customer, suggestions, linkedCall } = detail;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={sale.productName || "Sale"}
        description={
          customer ? `${customer.name || customer.email}` : "Customer details unavailable"
        }
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Stat label="Booked">
          <Money amount={sale.bookedAmount} currency={sale.currency} />
        </Stat>
        <Stat label="Collected">
          <Money amount={sale.collectedAmount} currency={sale.currency} />
        </Stat>
        <Stat label="Closed">
          <Time value={sale.closedAt} />
        </Stat>
      </section>

      <LinkerCard
        slug={slug}
        saleId={sale.id}
        linkedCall={linkedCall}
        suggestions={suggestions.map((s) => ({
          callId: s.callId,
          score: s.score,
          signals: s.signals,
          contactName: s.call.contactName ?? null,
          contactEmail: s.call.contactEmail ?? null,
          appointmentAt: s.call.appointmentAt ? s.call.appointmentAt.toISOString() : null,
        }))}
      />

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">
          Commission recipients · {recipients.length}
        </h2>
        {recipients.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
            No recipients. Sales-role assignments must exist before creating a sale.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
            {recipients.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="font-mono text-xs text-zinc-500">
                  {r.userId.slice(0, 8)}
                </span>
                <span className="flex-1 text-zinc-100">
                  {Math.round(Number(r.sharePct) * 100)}% share
                </span>
                <Pill>{r.status}</Pill>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">
          Installments · {installments.length}
        </h2>
        <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
          {installments.map((i) => (
            <li key={i.id} className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm">
              <span className="col-span-1 text-zinc-500">#{i.sequence}</span>
              <span className="col-span-3 text-zinc-100">
                <Money amount={i.expectedAmount} currency={i.currency} />
              </span>
              <span className="col-span-3 text-zinc-400">
                Due {new Date(i.expectedDate).toLocaleDateString()}
              </span>
              <span className="col-span-3">
                <Pill variant={i.status === "collected" ? "positive" : "neutral"}>
                  {i.status}
                </Pill>
              </span>
              <span className="col-span-2 text-right text-zinc-500">
                {i.collectedAt && <Time value={i.collectedAt} />}
              </span>
            </li>
          ))}
        </ul>
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
