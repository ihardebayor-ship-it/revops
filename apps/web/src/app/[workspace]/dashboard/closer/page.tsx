// Closer dashboard — insight-first.
// Hero question: "Am I going to hit quota — and which deals are at risk?"

import { and, desc, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { withTenant, schema } from "@revops/db/client";
import { analytics } from "@revops/domain";
import {
  EmptyState,
  ForecastCard,
  MetricCard,
  Money,
  PageHeader,
  Pill,
  Sparkline,
  Time,
} from "@revops/ui";
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

  const period = analytics.currentMonth();
  const prevPeriod = analytics.previousPeriod(period);

  const data = await withTenant(ctx.authCtx, async (db) => {
    const quota = await analytics.getActiveQuota(db, {
      workspaceId: ctx.workspace.id,
      userId,
      subAccountId: subId,
    });

    const [attainmentResult, prevAttainment, pipeline, bookedSeries, commissionPipelineSeries] =
      await Promise.all([
        analytics.attainment(db, {
          workspaceId: ctx.workspace.id,
          subAccountId: subId,
          userId,
          quota: quota?.targetValue ?? 0,
          period,
        }),
        analytics.attainment(db, {
          workspaceId: ctx.workspace.id,
          subAccountId: subId,
          userId,
          quota: quota?.targetValue ?? 0,
          period: prevPeriod,
        }),
        analytics.pipelineHealth(db, {
          workspaceId: ctx.workspace.id,
          subAccountId: subId,
          userId,
        }),
        analytics.bookedAmountSeries(db, {
          workspaceId: ctx.workspace.id,
          subAccountId: subId,
          userId,
          period: { from: new Date(Date.now() - 30 * 24 * 3600 * 1000), to: new Date() },
        }),
        analytics.commissionAvailableSeries(db, {
          workspaceId: ctx.workspace.id,
          subAccountId: subId,
          userId,
          period: { from: new Date(), to: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
        }),
      ]);

    const staleCalls = await db
      .select({
        id: schema.calls.id,
        contactName: schema.calls.contactName,
        contactEmail: schema.calls.contactEmail,
        appointmentAt: schema.calls.appointmentAt,
      })
      .from(schema.calls)
      .where(
        and(
          eq(schema.calls.subAccountId, subId),
          eq(schema.calls.closerUserId, userId),
          isNotNull(schema.calls.appointmentAt),
          lte(schema.calls.appointmentAt, new Date()),
          isNull(schema.calls.completedAt),
          isNull(schema.calls.dispositionId),
          isNull(schema.calls.deletedAt),
        ),
      )
      .orderBy(desc(schema.calls.appointmentAt))
      .limit(5);

    const unlinkedSales = await db
      .select({
        id: schema.sales.id,
        productName: schema.sales.productName,
        bookedAmount: schema.sales.bookedAmount,
        currency: schema.sales.currency,
        closedAt: schema.sales.closedAt,
        sharePct: schema.commissionRecipients.sharePct,
      })
      .from(schema.commissionRecipients)
      .innerJoin(schema.sales, eq(schema.sales.id, schema.commissionRecipients.saleId))
      .where(
        and(
          eq(schema.commissionRecipients.userId, userId),
          eq(schema.sales.subAccountId, subId),
          isNull(schema.sales.linkedCallId),
          isNull(schema.sales.deletedAt),
          isNull(schema.commissionRecipients.deletedAt),
          gte(schema.sales.closedAt, new Date(Date.now() - 30 * 24 * 3600 * 1000)),
        ),
      )
      .orderBy(desc(schema.sales.closedAt))
      .limit(5);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const [refundCounts] = await db
      .select({
        total: sql<number>`count(*)::int`,
        refunded: sql<number>`count(*) filter (where ${schema.sales.refundStatus} = 'issued')::int`,
      })
      .from(schema.sales)
      .innerJoin(
        schema.commissionRecipients,
        eq(schema.commissionRecipients.saleId, schema.sales.id),
      )
      .where(
        and(
          eq(schema.commissionRecipients.userId, userId),
          eq(schema.sales.subAccountId, subId),
          isNull(schema.sales.deletedAt),
          gte(schema.sales.closedAt, thirtyDaysAgo),
        ),
      );

    return {
      quota,
      attainment: attainmentResult,
      prevAttainment,
      pipeline,
      bookedSeries,
      commissionPipelineSeries,
      staleCalls,
      unlinkedSales,
      refundCounts,
    };
  });

  const currency = "USD";
  const attainmentCmp = analytics.compareMetrics(
    data.attainment.attained,
    data.prevAttainment.attained || null,
  );
  const refundRate =
    data.refundCounts && data.refundCounts.total > 0
      ? data.refundCounts.refunded / data.refundCounts.total
      : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Closer"
        description={`${ctx.workspace.name} · ${monthLabel(period.from)}`}
      />

      {data.quota ? (
        <ForecastCard
          headline={forecastHeadline(data.attainment)}
          status={data.attainment.status}
          primaryValue={
            <Money amount={data.attainment.attained.toFixed(2)} currency={currency} />
          }
          primaryLabel={`of ${money(data.quota.targetValue, currency)} quota · ${data.attainment.daysRemaining} days left`}
          secondaryValue={
            <Money amount={data.attainment.forecastEnd.toFixed(2)} currency={currency} />
          }
          secondaryLabel="forecast end-of-month"
          progressPct={data.attainment.attainmentPct}
          paceMark={data.attainment.daysElapsed / Math.max(1, data.attainment.totalDays)}
          footnote={attainmentFootnote(data.attainment, currency)}
        />
      ) : (
        <ForecastCard
          headline="No quota set yet"
          status="on_pace"
          primaryValue={
            <Money amount={data.attainment.attained.toFixed(2)} currency={currency} />
          }
          primaryLabel="attributed booked this month"
          progressPct={0}
          footnote="Set a quota in goals to see forecast tracking."
        />
      )}

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard
          label="Pipeline coverage"
          value={
            data.pipeline.coverageRatio !== null
              ? `${data.pipeline.coverageRatio.toFixed(1)}×`
              : `${data.pipeline.totalCallCount} upcoming`
          }
          comparison={
            data.pipeline.weightedPipelineValue > 0
              ? `${money(data.pipeline.weightedPipelineValue, currency)} weighted`
              : "no weighted pipeline yet"
          }
        />
        <MetricCard
          label="Attainment vs last month"
          value={<Money amount={data.attainment.attained.toFixed(2)} currency={currency} />}
          trend={attainmentCmp.trend}
          deltaPct={attainmentCmp.deltaPct}
          series={data.bookedSeries.map((p) => p.value)}
          sparklineTone={
            attainmentCmp.trend === "up"
              ? "emerald"
              : attainmentCmp.trend === "down"
                ? "rose"
                : "blue"
          }
          comparison={
            attainmentCmp.previous !== null
              ? `prev ${money(attainmentCmp.previous, currency)}`
              : "first period"
          }
        />
        <MetricCard
          label="Refund rate (30d)"
          value={refundRate !== null ? `${(refundRate * 100).toFixed(1)}%` : "—"}
          comparison={
            data.refundCounts
              ? `${data.refundCounts.refunded} of ${data.refundCounts.total} sales`
              : undefined
          }
          invertColors
        />
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-300">Hold-release timeline (next 30d)</h2>
          <span className="text-xs text-zinc-500">
            Total{" "}
            <Money
              amount={data.commissionPipelineSeries
                .reduce((acc, p) => acc + p.value, 0)
                .toFixed(2)}
              currency={currency}
            />
          </span>
        </div>
        <Sparkline
          values={data.commissionPipelineSeries.map((p) => p.value)}
          width={520}
          height={48}
          tone="emerald"
        />
        <p className="mt-2 text-xs text-zinc-500">
          Each point is a day of commission $ becoming available. Past hold periods have
          already cleared into your paid balance.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-medium text-zinc-300">
            Stale calls · {data.staleCalls.length}
          </h2>
          {data.staleCalls.length === 0 ? (
            <EmptyState title="Inbox clear." description="No appointments missing a disposition." />
          ) : (
            <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
              {data.staleCalls.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <Pill variant="warning">no disposition</Pill>
                  <a
                    href={`/${slug}/calls/${c.id}`}
                    className="flex-1 text-zinc-100 hover:text-blue-400"
                  >
                    {c.contactName || c.contactEmail || "Call"}
                  </a>
                  <span className="text-xs text-zinc-500">
                    {c.appointmentAt && <Time value={c.appointmentAt} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium text-zinc-300">
            Unlinked sales · {data.unlinkedSales.length}
          </h2>
          {data.unlinkedSales.length === 0 ? (
            <EmptyState
              title="Every sale is linked."
              description="Reconciliation looks healthy."
            />
          ) : (
            <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
              {data.unlinkedSales.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <Pill variant="warning">unlinked</Pill>
                  <a
                    href={`/${slug}/sales/${s.id}`}
                    className="flex-1 text-zinc-100 hover:text-blue-400"
                  >
                    {s.productName || "Sale"}
                  </a>
                  <span className="text-xs text-zinc-500">
                    {Math.round(Number(s.sharePct) * 100)}% of{" "}
                    <Money amount={s.bookedAmount} currency={s.currency} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function forecastHeadline(a: analytics.AttainmentResult): string {
  if (a.quota === 0) return "Tracking";
  const pct = Math.round((a.forecastEnd / a.quota) * 100);
  if (a.status === "ahead") return `Tracking to ${pct}% of quota — ahead of pace`;
  if (a.status === "on_pace") return `Tracking to ${pct}% of quota — on pace`;
  if (a.status === "behind") return `Tracking to ${pct}% of quota — behind pace`;
  return `Tracking to ${pct}% of quota — at risk`;
}

function attainmentFootnote(a: analytics.AttainmentResult, currency: string): string {
  if (a.quota === 0) return "No quota active for this period.";
  if (a.status === "ahead") {
    return `Already over pace — projected to land ${money(a.forecastEnd - a.quota, currency)} above quota.`;
  }
  if (a.daysRemaining === 0) {
    return `Period closed. Final attainment ${(a.attainmentPct * 100).toFixed(0)}%.`;
  }
  if (a.requiredDailyRunRate <= 0) {
    return `${a.daysRemaining} days left. Quota covered.`;
  }
  return `Need ${money(a.requiredDailyRunRate, currency)}/day for the remaining ${a.daysRemaining} days to hit quota.`;
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function monthLabel(d: Date): string {
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}
