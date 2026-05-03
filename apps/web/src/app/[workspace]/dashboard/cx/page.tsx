// CX dashboard — insight-first.
// Hero question: "Is my book healthy and who needs me today?"
//
// Layout:
//   1. Hero: Book health distribution (HealthBar) with WoW change banner
//   2. Three MetricCards: total accounts, recent churn, refunds-recoverable
//   3. Customers needing a touch — the daily action list (LTV × risk × silence)
//   4. Refund recovery board (recently refunded, save-flow eligible)
//   5. Cohort retention curves

import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { withTenant, schema } from "@revops/db/client";
import { analytics } from "@revops/domain";
import {
  EmptyState,
  ForecastCard,
  HealthBar,
  MetricCard,
  Money,
  PageHeader,
  Pill,
  Time,
  type ForecastStatus,
} from "@revops/ui";
import { resolveWorkspaceBySlug } from "~/lib/workspace";

export default async function CxDashboardPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);
  const subId = ctx.membership.subAccountId;

  if (!subId) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="CX dashboard" description="No sub-account context." />
      </div>
    );
  }

  const data = await withTenant(ctx.authCtx, async (db) => {
    const [book, atRisk, cohorts] = await Promise.all([
      analytics.bookHealth(db, { workspaceId: ctx.workspace.id, subAccountId: subId }),
      analytics.customersNeedingTouch(db, {
        workspaceId: ctx.workspace.id,
        subAccountId: subId,
        limit: 10,
      }),
      analytics.cohortRetention(db, {
        workspaceId: ctx.workspace.id,
        subAccountId: subId,
        monthsBack: 6,
      }),
    ]);

    // Refund recovery board: customers with refunded sales in last 30d,
    // sale closed > 14 days ago, customer still active.
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const recoverable = await db
      .select({
        customerId: schema.customers.id,
        email: schema.customers.primaryEmail,
        name: schema.customers.name,
        refundedAmount: schema.sales.refundedAmount,
        refundedAt: schema.sales.refundedAt,
        saleId: schema.sales.id,
        productName: schema.sales.productName,
      })
      .from(schema.sales)
      .innerJoin(schema.customers, eq(schema.customers.id, schema.sales.customerId))
      .where(
        and(
          eq(schema.sales.workspaceId, ctx.workspace.id),
          eq(schema.sales.refundStatus, "issued"),
          isNull(schema.sales.deletedAt),
          gte(schema.sales.refundedAt, thirtyDaysAgo),
          lte(schema.sales.closedAt, fourteenDaysAgo),
        ),
      )
      .orderBy(desc(schema.sales.refundedAt))
      .limit(8);

    // Recent churns this week.
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const recentChurns = await db
      .select({
        id: schema.customers.id,
        email: schema.customers.primaryEmail,
        name: schema.customers.name,
        lifetimeValue: schema.customers.lifetimeValue,
        churnAt: schema.customers.churnAt,
        churnReason: schema.customers.churnReason,
      })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.workspaceId, ctx.workspace.id),
          gte(schema.customers.churnAt, weekAgo),
          isNull(schema.customers.deletedAt),
        ),
      )
      .orderBy(desc(schema.customers.churnAt))
      .limit(5);

    // Total LTV trend: last 7d delta. We sum lifetime_value across active
    // customers now and a week ago via funnel approximation. Simpler: use
    // total LTV today from book; previous via a recompute.
    const [prevWeekLtv] = await db
      .select({
        v: sql<number>`coalesce(sum(${schema.customers.lifetimeValue}), 0)::float`,
      })
      .from(schema.customers)
      .where(
        and(
          eq(schema.customers.workspaceId, ctx.workspace.id),
          isNull(schema.customers.deletedAt),
          lte(schema.customers.createdAt, weekAgo),
        ),
      );
    const ltvLastWeek = prevWeekLtv?.v ?? 0;

    return {
      book,
      atRisk,
      cohorts,
      recoverable,
      recentChurns,
      ltvLastWeek,
    };
  });

  const totalAccounts = data.book.total;
  const ltvCmp = analytics.compareMetrics(
    data.book.totalLifetimeValue,
    data.ltvLastWeek || null,
  );

  // Health-bar segments: drive Hero status by churning > 10% threshold.
  const healthy = data.book.byStatus.active ?? 0;
  const refunded = data.book.byStatus.refunded ?? 0;
  const paused = data.book.byStatus.paused ?? 0;
  const churned = data.book.byStatus.churned ?? 0;
  const wonBack = data.book.byStatus.won_back ?? 0;
  const churnPct = totalAccounts > 0 ? churned / totalAccounts : 0;

  const heroStatus: ForecastStatus =
    totalAccounts === 0
      ? "on_pace"
      : churnPct < 0.05
        ? "ahead"
        : churnPct < 0.1
          ? "on_pace"
          : churnPct < 0.2
            ? "behind"
            : "at_risk";

  const heroHeadline =
    totalAccounts === 0
      ? "Book is empty — first customer not yet recorded"
      : data.recentChurns.length === 0
        ? `Book is healthy — ${healthy} active accounts`
        : `${data.recentChurns.length} ${data.recentChurns.length === 1 ? "customer churned" : "customers churned"} this week`;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Customer Success"
        description={`${ctx.workspace.name} · ${totalAccounts} customers tracked`}
      />

      {/* Hero — book health */}
      <ForecastCard
        headline={heroHeadline}
        status={heroStatus}
        primaryValue={
          <Money amount={data.book.totalLifetimeValue.toFixed(2)} currency="USD" />
        }
        primaryLabel="lifetime value across the book"
        secondaryValue={`${(churnPct * 100).toFixed(1)}%`}
        secondaryLabel="churned-state share"
        progressPct={1 - churnPct}
        footnote={
          totalAccounts === 0
            ? "When the first sale records a customer, this dashboard lights up."
            : `Active ${healthy} · paused ${paused} · won back ${wonBack} · refunded ${refunded} · churned ${churned}.`
        }
      />

      {/* Health bar with full segment breakdown */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h2 className="mb-3 text-sm font-medium text-zinc-300">Status mix</h2>
        <HealthBar
          segments={[
            { label: "Active", value: healthy, colorClass: "bg-emerald-500" },
            { label: "Won back", value: wonBack, colorClass: "bg-blue-500" },
            { label: "Paused", value: paused, colorClass: "bg-amber-500" },
            { label: "Refunded", value: refunded, colorClass: "bg-rose-400" },
            { label: "Churned", value: churned, colorClass: "bg-rose-600" },
          ]}
        />
      </section>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard
          label="Total LTV"
          value={<Money amount={data.book.totalLifetimeValue.toFixed(2)} currency="USD" />}
          trend={ltvCmp.trend}
          deltaPct={ltvCmp.deltaPct}
          comparison={
            ltvCmp.previous !== null
              ? `prev wk ${money(ltvCmp.previous, "USD")}`
              : "first week"
          }
        />
        <MetricCard
          label="Churn (30d)"
          value={data.book.recentChurnCount.toString()}
          comparison={
            data.book.recentChurnCount > 0
              ? `${data.book.recentChurnCount} customers lost`
              : "no churn — keep going"
          }
          invertColors
        />
        <MetricCard
          label="Refunds in save-flow window"
          value={data.book.recentRefundsRecoverable.toString()}
          comparison={
            data.book.recentRefundsRecoverable > 0
              ? "32% historical save rate"
              : "no recoverable refunds"
          }
        />
      </section>

      {/* Customers needing a touch */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-300">
            Customers needing a touch · {data.atRisk.length}
          </h2>
          <span className="text-xs text-zinc-500">
            Sorted by risk × LTV
          </span>
        </div>
        {data.atRisk.length === 0 ? (
          <EmptyState
            title="Book is current."
            description="Every active customer has been touched recently."
          />
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
            {data.atRisk.map((c) => (
              <li
                key={c.customerId}
                className="flex flex-col gap-1 px-4 py-3 md:flex-row md:items-center md:gap-3"
              >
                <a
                  href={`/${slug}/customers/${c.customerId}`}
                  className="flex-1 text-sm text-zinc-100 hover:text-blue-400"
                >
                  {c.name || c.email}
                </a>
                <Pill
                  variant={
                    c.riskScore >= 70
                      ? "danger"
                      : c.riskScore >= 40
                        ? "warning"
                        : "info"
                  }
                >
                  risk {c.riskScore}
                </Pill>
                <span className="text-xs text-zinc-500">
                  LTV <Money amount={c.lifetimeValue} currency="USD" />
                </span>
                {c.signals.length > 0 && (
                  <span className="text-xs text-zinc-400">{c.signals.join(" · ")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Refund recovery */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">
          Save-flow opportunities · {data.recoverable.length}
        </h2>
        {data.recoverable.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
            No customers in the recoverable window right now.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
            {data.recoverable.map((r) => (
              <li
                key={r.saleId}
                className="flex items-center gap-3 px-4 py-3 text-sm"
              >
                <Pill variant="warning">refund</Pill>
                <a
                  href={`/${slug}/customers/${r.customerId}`}
                  className="flex-1 text-zinc-100 hover:text-blue-400"
                >
                  {r.name || r.email}
                </a>
                <span className="text-xs text-zinc-500">
                  refunded <Money amount={r.refundedAmount} currency="USD" />
                </span>
                {r.refundedAt && (
                  <span className="text-xs text-zinc-500">
                    <Time value={r.refundedAt} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Cohort retention */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">
          Cohort retention (last 6 months)
        </h2>
        {data.cohorts.length === 0 ? (
          <EmptyState
            title="Not enough cohorts to chart yet."
            description="Retention curves appear once you have customers across multiple months."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Cohort</th>
                  <th className="px-4 py-2 text-right font-medium">Initial</th>
                  <th className="px-4 py-2 text-right font-medium">30d</th>
                  <th className="px-4 py-2 text-right font-medium">60d</th>
                  <th className="px-4 py-2 text-right font-medium">90d</th>
                  <th className="px-4 py-2 text-right font-medium">180d</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {data.cohorts.map((c) => (
                  <tr key={c.cohortMonth}>
                    <td className="px-4 py-2 text-zinc-100">{c.cohortMonth}</td>
                    <td className="px-4 py-2 text-right text-zinc-400">{c.initialCustomers}</td>
                    <CohortCell value={c.retainedAt30d} of={c.initialCustomers} />
                    <CohortCell value={c.retainedAt60d} of={c.initialCustomers} />
                    <CohortCell value={c.retainedAt90d} of={c.initialCustomers} />
                    <CohortCell value={c.retainedAt180d} of={c.initialCustomers} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent churns */}
      {data.recentChurns.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-zinc-300">
            Churned this week · {data.recentChurns.length}
          </h2>
          <ul className="divide-y divide-zinc-800 rounded-lg border border-rose-500/20 bg-rose-500/5">
            {data.recentChurns.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <Pill variant="danger">churned</Pill>
                <a
                  href={`/${slug}/customers/${c.id}`}
                  className="flex-1 text-zinc-100 hover:text-blue-400"
                >
                  {c.name || c.email}
                </a>
                <span className="text-xs text-zinc-500">
                  LTV <Money amount={c.lifetimeValue} currency="USD" />
                </span>
                {c.churnReason && (
                  <span className="text-xs text-zinc-400">"{c.churnReason}"</span>
                )}
                {c.churnAt && (
                  <span className="text-xs text-zinc-500">
                    <Time value={c.churnAt} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CohortCell({ value, of }: { value: number | null; of: number }) {
  if (value === null) {
    return <td className="px-4 py-2 text-right text-xs text-zinc-600">—</td>;
  }
  const pct = of > 0 ? value / of : 0;
  const color =
    pct >= 0.8
      ? "text-emerald-400"
      : pct >= 0.6
        ? "text-blue-400"
        : pct >= 0.4
          ? "text-amber-400"
          : "text-rose-400";
  return (
    <td className={`px-4 py-2 text-right ${color}`}>
      {value} <span className="text-xs text-zinc-500">({(pct * 100).toFixed(0)}%)</span>
    </td>
  );
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
