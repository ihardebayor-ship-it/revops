import { and, count, eq, gte, isNull, sql, sum } from "drizzle-orm";
import { withTenant, schema } from "@revops/db/client";
import { Money, PageHeader, Pill, Time } from "@revops/ui";
import { resolveWorkspaceBySlug } from "~/lib/workspace";

export default async function CloserDashboardPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);
  const userId = ctx.authCtx.userId;
  const subId = ctx.membership.subAccountId;

  if (!subId) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Closer dashboard" description="No sub-account context." />
      </div>
    );
  }

  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const data = await withTenant(ctx.authCtx, async (db) => {
    // Sales I'm a recipient on, this month.
    const myRecipientSales = await db
      .select({
        saleId: schema.sales.id,
        productName: schema.sales.productName,
        bookedAmount: schema.sales.bookedAmount,
        currency: schema.sales.currency,
        sharePct: schema.commissionRecipients.sharePct,
        closedAt: schema.sales.closedAt,
        linkedCallId: schema.sales.linkedCallId,
      })
      .from(schema.commissionRecipients)
      .innerJoin(schema.sales, eq(schema.sales.id, schema.commissionRecipients.saleId))
      .where(
        and(
          eq(schema.commissionRecipients.userId, userId),
          eq(schema.sales.subAccountId, subId),
          gte(schema.sales.closedAt, monthAgo),
          isNull(schema.sales.deletedAt),
          isNull(schema.commissionRecipients.deletedAt),
        ),
      )
      .orderBy(schema.sales.closedAt)
      .limit(20);

    const [bookedThisMonth] = await db
      .select({
        booked: sql<string>`COALESCE(SUM(s.booked_amount * cr.share_pct), 0)::text`,
      })
      .from(sql`commission_recipients cr JOIN sales s ON s.id = cr.sale_id`)
      .where(
        sql`cr.user_id = ${userId} AND s.sub_account_id = ${subId} AND s.closed_at >= ${monthAgo.toISOString()} AND s.deleted_at IS NULL AND cr.deleted_at IS NULL`,
      );

    const [closedCount] = await db
      .select({ n: count() })
      .from(schema.sales)
      .innerJoin(
        schema.commissionRecipients,
        eq(schema.commissionRecipients.saleId, schema.sales.id),
      )
      .where(
        and(
          eq(schema.commissionRecipients.userId, userId),
          eq(schema.sales.subAccountId, subId),
          gte(schema.sales.closedAt, weekAgo),
          isNull(schema.sales.deletedAt),
        ),
      );

    const [unlinkedCount] = await db
      .select({ n: count() })
      .from(schema.sales)
      .where(
        and(
          eq(schema.sales.subAccountId, subId),
          isNull(schema.sales.linkedCallId),
          isNull(schema.sales.deletedAt),
        ),
      );

    const todaysCalls = await db
      .select({
        id: schema.calls.id,
        contactName: schema.calls.contactName,
        contactEmail: schema.calls.contactEmail,
        appointmentAt: schema.calls.appointmentAt,
        showedAt: schema.calls.showedAt,
        completedAt: schema.calls.completedAt,
      })
      .from(schema.calls)
      .where(
        and(
          eq(schema.calls.subAccountId, subId),
          eq(schema.calls.closerUserId, userId),
          gte(schema.calls.appointmentAt, weekAgo),
          isNull(schema.calls.deletedAt),
        ),
      )
      .orderBy(schema.calls.appointmentAt)
      .limit(10);

    return {
      myRecipientSales,
      bookedThisMonthAttributed: bookedThisMonth?.booked ?? "0",
      closedCount: closedCount?.n ?? 0,
      unlinkedCount: unlinkedCount?.n ?? 0,
      todaysCalls,
    };
  });

  const currency = data.myRecipientSales[0]?.currency ?? "USD";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Closer dashboard"
        description={`Your pipeline, attributed sales, and unlinked queue for ${ctx.workspace.name}.`}
      />

      <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Stat
          label="Attributed booked (30d)"
          value={<Money amount={data.bookedThisMonthAttributed} currency={currency} />}
          accent="blue"
        />
        <Stat label="Closes (7d)" value={data.closedCount} accent="green" />
        <Stat
          label="Pipeline calls (7d)"
          value={data.todaysCalls.length}
          accent="purple"
        />
        <Stat
          label="Unlinked sales"
          value={data.unlinkedCount}
          accent={data.unlinkedCount > 0 ? "amber" : undefined}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">
          My sales (30d) · {data.myRecipientSales.length}
        </h2>
        {data.myRecipientSales.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
            No sales attributed to you in the last 30 days.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
            {data.myRecipientSales.map((s) => (
              <li
                key={s.saleId}
                className="flex items-center gap-3 px-4 py-3 text-sm"
              >
                {s.linkedCallId ? (
                  <Pill variant="positive">Linked</Pill>
                ) : (
                  <Pill variant="warning">Unlinked</Pill>
                )}
                <a
                  href={`/${slug}/sales/${s.saleId}`}
                  className="flex-1 text-zinc-100 hover:text-blue-400"
                >
                  {s.productName || "Sale"}
                </a>
                <span className="text-xs text-zinc-500">
                  {Math.round(Number(s.sharePct) * 100)}% of{" "}
                  <Money amount={s.bookedAmount} currency={s.currency} />
                </span>
                <span className="text-xs text-zinc-500">
                  <Time value={s.closedAt} format="date" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">
          My pipeline (7d) · {data.todaysCalls.length}
        </h2>
        {data.todaysCalls.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
            No calls in your pipeline this week.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
            {data.todaysCalls.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                {c.completedAt ? (
                  <Pill variant="positive">Completed</Pill>
                ) : c.showedAt ? (
                  <Pill variant="info">Showed</Pill>
                ) : (
                  <Pill>Booked</Pill>
                )}
                <a
                  href={`/${slug}/calls/${c.id}`}
                  className="flex-1 text-zinc-100 hover:text-blue-400"
                >
                  {c.contactName || c.contactEmail}
                </a>
                {c.appointmentAt && (
                  <span className="text-xs text-zinc-500">
                    <Time value={c.appointmentAt} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  accent?: "blue" | "green" | "purple" | "amber";
}) {
  const cls =
    accent === "blue"
      ? "text-blue-400"
      : accent === "green"
        ? "text-green-400"
        : accent === "purple"
          ? "text-purple-400"
          : accent === "amber"
            ? "text-amber-400"
            : "text-zinc-100";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight ${cls}`}>{value}</p>
    </div>
  );
}

void sum;
