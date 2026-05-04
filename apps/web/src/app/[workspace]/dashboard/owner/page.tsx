// Owner / exec dashboard — insight-first.
// Hero question: "Where is the business going — cash, growth, unit economics?"
//
// Layout:
//   1. Hero forecast: trailing-12w run rate + next-4w projection +
//      vs same period last year
//   2. Cash forecast row: net 30/60/90d (gross minus refund haircut),
//      commission obligations next 90d
//   3. Cohort retention waterfall (reuses CX dashboard's analytics)
//   4. Concentration risk: top customer + top source % of revenue
//   5. Agent productivity: tool calls + ROI

import { analytics } from "@revops/domain";
import { withTenant } from "@revops/db/client";
import {
  ForecastCard,
  HealthBar,
  MetricCard,
  Money,
  PageHeader,
  Sparkline,
  TrendArrow,
} from "@revops/ui";
import { resolveWorkspaceBySlug } from "~/lib/workspace";

const CONCENTRATION_DANGER_THRESHOLD = 0.3;

export default async function OwnerDashboardPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);
  const subId = ctx.membership.subAccountId;

  const data = await withTenant(ctx.authCtx, async (db) => {
    const [trajectory, cash, concentration, productivity, cohorts, bookHealthSummary] =
      await Promise.all([
        analytics.revenueTrajectory(db, {
          workspaceId: ctx.workspace.id,
          subAccountId: subId ?? undefined,
        }),
        analytics.cashForecast(db, {
          workspaceId: ctx.workspace.id,
          subAccountId: subId ?? undefined,
        }),
        analytics.concentrationRisk(db, {
          workspaceId: ctx.workspace.id,
          subAccountId: subId ?? undefined,
        }),
        analytics.agentProductivity(db, { workspaceId: ctx.workspace.id }),
        analytics.cohortRetention(db, {
          workspaceId: ctx.workspace.id,
          subAccountId: subId ?? undefined,
          monthsBack: 6,
        }),
        analytics.bookHealth(db, {
          workspaceId: ctx.workspace.id,
          subAccountId: subId ?? undefined,
        }),
      ]);
    return { trajectory, cash, concentration, productivity, cohorts, bookHealthSummary };
  });

  const trajectoryCmp = analytics.compareMetrics(
    data.trajectory.historyTotal,
    data.trajectory.previousYearSamePeriodTotal,
  );

  const heroStatus: "ahead" | "on_pace" | "behind" | "at_risk" = (() => {
    if (data.trajectory.previousYearSamePeriodTotal === null) return "on_pace";
    const pct = data.trajectory.historyTotal / data.trajectory.previousYearSamePeriodTotal;
    if (pct >= 1.1) return "ahead";
    if (pct >= 0.9) return "on_pace";
    if (pct >= 0.7) return "behind";
    return "at_risk";
  })();

  // Cohort retention summary — average 30/60/90d retention across cohorts that aged that far.
  const cohortAvg = (() => {
    const ats = (k: "retainedAt30d" | "retainedAt60d" | "retainedAt90d") => {
      const rows = data.cohorts.filter((c) => c[k] !== null && c.initialCustomers > 0);
      if (rows.length === 0) return null;
      const sum = rows.reduce((acc, c) => acc + c[k]! / c.initialCustomers, 0);
      return sum / rows.length;
    };
    return { d30: ats("retainedAt30d"), d60: ats("retainedAt60d"), d90: ats("retainedAt90d") };
  })();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Owner"
        description={`${ctx.workspace.name} · trailing 12 weeks + 4-week projection`}
      />

      {/* Hero: revenue trajectory */}
      <ForecastCard
        headline={trajectoryHeadline(data.trajectory, trajectoryCmp.deltaPct)}
        status={heroStatus}
        primaryValue={
          <Money amount={data.trajectory.historyTotal.toFixed(0)} currency="USD" />
        }
        primaryLabel="trailing 12 weeks booked"
        secondaryValue={
          <Money amount={data.trajectory.forecastTotal.toFixed(0)} currency="USD" />
        }
        secondaryLabel="next 4 weeks (projected)"
        progressPct={
          data.trajectory.previousYearSamePeriodTotal && data.trajectory.previousYearSamePeriodTotal > 0
            ? Math.min(2, data.trajectory.historyTotal / data.trajectory.previousYearSamePeriodTotal) /
              2
            : 0.5
        }
        footnote={
          data.trajectory.previousYearSamePeriodTotal !== null
            ? `Same period last year: ${money(data.trajectory.previousYearSamePeriodTotal)}.`
            : "Not enough history yet for year-over-year comparison."
        }
      />

      {/* Run-rate sparkline (history + forecast) */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-300">Weekly run rate</h2>
          <span className="text-xs text-zinc-500">
            12 weeks history · 4 weeks projection
          </span>
        </div>
        <Sparkline
          values={[
            ...data.trajectory.history.map((p) => p.value),
            ...data.trajectory.forecast.map((p) => p.value),
          ]}
          width={520}
          height={64}
          tone={trajectoryCmp.trend === "down" ? "rose" : "emerald"}
          referenceLine={
            data.trajectory.previousYearSamePeriodTotal && data.trajectory.history.length > 0
              ? data.trajectory.previousYearSamePeriodTotal / data.trajectory.history.length
              : undefined
          }
        />
        <p className="mt-2 text-xs text-zinc-500">
          Dashed line = year-ago weekly average. Right-most points are the trailing-4-week
          forecast extension.
        </p>
      </section>

      {/* Cash forecast */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">
          Cash forecast (net of refund risk)
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <MetricCard
            label="Next 30 days"
            value={<Money amount={data.cash.netNext30d.toFixed(0)} currency="USD" />}
            comparison={`gross ${money(data.cash.grossNext30d)}`}
          />
          <MetricCard
            label="Next 60 days"
            value={<Money amount={data.cash.netNext60d.toFixed(0)} currency="USD" />}
            comparison={`gross ${money(data.cash.grossNext60d)}`}
          />
          <MetricCard
            label="Next 90 days"
            value={<Money amount={data.cash.netNext90d.toFixed(0)} currency="USD" />}
            comparison={`gross ${money(data.cash.grossNext90d)}`}
          />
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Net = expected scheduled installments × (1 − historical refund rate of{" "}
          {(data.cash.refundRate * 100).toFixed(1)}%). Commission obligations releasing in
          the next 90 days:{" "}
          <span className="text-zinc-300">
            {money(data.cash.commissionObligations90d)}
          </span>
          .
        </p>
      </section>

      {/* Cohort retention */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">
          Cohort retention · last 6 cohorts
        </h2>
        {data.cohorts.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
            No cohort data yet. Customer status updates feed this.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <MetricCard
                label="30-day retention"
                value={cohortAvg.d30 !== null ? `${(cohortAvg.d30 * 100).toFixed(0)}%` : "—"}
                comparison="avg across aged cohorts"
              />
              <MetricCard
                label="60-day retention"
                value={cohortAvg.d60 !== null ? `${(cohortAvg.d60 * 100).toFixed(0)}%` : "—"}
                comparison="avg across aged cohorts"
              />
              <MetricCard
                label="90-day retention"
                value={cohortAvg.d90 !== null ? `${(cohortAvg.d90 * 100).toFixed(0)}%` : "—"}
                comparison="avg across aged cohorts"
              />
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-400">
                  <tr>
                    <th className="px-4 py-2 font-medium">Cohort</th>
                    <th className="px-4 py-2 text-right font-medium">Initial</th>
                    <th className="px-4 py-2 text-right font-medium">+30d</th>
                    <th className="px-4 py-2 text-right font-medium">+60d</th>
                    <th className="px-4 py-2 text-right font-medium">+90d</th>
                    <th className="px-4 py-2 text-right font-medium">+180d</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {data.cohorts.map((c) => (
                    <tr key={c.cohortMonth} className="hover:bg-zinc-900/50">
                      <td className="px-4 py-2 font-mono text-xs text-zinc-300">
                        {c.cohortMonth}
                      </td>
                      <td className="px-4 py-2 text-right text-zinc-100">
                        {c.initialCustomers}
                      </td>
                      <td className="px-4 py-2 text-right text-zinc-400">
                        {retentionCell(c.initialCustomers, c.retainedAt30d)}
                      </td>
                      <td className="px-4 py-2 text-right text-zinc-400">
                        {retentionCell(c.initialCustomers, c.retainedAt60d)}
                      </td>
                      <td className="px-4 py-2 text-right text-zinc-400">
                        {retentionCell(c.initialCustomers, c.retainedAt90d)}
                      </td>
                      <td className="px-4 py-2 text-right text-zinc-400">
                        {retentionCell(c.initialCustomers, c.retainedAt180d)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Book health snapshot */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">Book of business</h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-wider text-zinc-400">
              {data.bookHealthSummary.total} customers · LTV{" "}
              {money(data.bookHealthSummary.totalLifetimeValue)}
            </p>
            {data.bookHealthSummary.recentChurnCount > 0 && (
              <span className="text-xs text-rose-400">
                {data.bookHealthSummary.recentChurnCount} churned in last 30d
              </span>
            )}
          </div>
          <div className="mt-3">
            <HealthBar
              segments={statusSegments(data.bookHealthSummary.byStatus)}
            />
          </div>
        </div>
      </section>

      {/* Concentration risk */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">Concentration risk</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <RiskCard
            label="Top customer share"
            pct={data.concentration.topCustomerPct}
            primary={data.concentration.topCustomerName ?? "—"}
            secondary={`${money(data.concentration.topCustomerRevenue)} of ${money(data.concentration.totalRevenue)} (90d)`}
          />
          <RiskCard
            label="Top source share"
            pct={data.concentration.topSourcePct}
            primary={data.concentration.topSourceName ?? "—"}
            secondary={`${money(data.concentration.topSourceRevenue)} of ${money(data.concentration.totalRevenue)} (90d)`}
          />
        </div>
        {(data.concentration.topCustomerPct >= CONCENTRATION_DANGER_THRESHOLD ||
          data.concentration.topSourcePct >= CONCENTRATION_DANGER_THRESHOLD) && (
          <p className="mt-2 text-xs text-amber-400">
            Concentration ≥30% means a single customer or channel can move the whole
            business. Investors will ask about this; consider diversification on the
            board agenda.
          </p>
        )}
      </section>

      {/* Agent productivity */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">Agent ROI · last 7 days</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <MetricCard
            label="Tool calls"
            value={data.productivity.totalToolCalls.toString()}
            comparison={`${data.productivity.uniqueUsers} users active`}
          />
          <MetricCard
            label="Mutations"
            value={data.productivity.mutatingToolCalls.toString()}
            comparison={`${data.productivity.totalToolCalls - data.productivity.mutatingToolCalls} reads`}
          />
          <MetricCard
            label="Top tool"
            value={data.productivity.topTools[0]?.tool ?? "—"}
            comparison={
              data.productivity.topTools[0]
                ? `${data.productivity.topTools[0].count} calls`
                : "no agent activity yet"
            }
          />
        </div>
        {data.productivity.topTools.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2 text-xs">
            {data.productivity.topTools.map((t) => (
              <li
                key={t.tool}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-300"
              >
                <span className="font-mono text-blue-400">{t.tool}</span>
                <span className="ml-1 text-zinc-500">× {t.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function trajectoryHeadline(
  t: { historyTotal: number; previousYearSamePeriodTotal: number | null },
  deltaPct: number | null,
): string {
  if (t.previousYearSamePeriodTotal === null) {
    return `${money(t.historyTotal)} booked over the last 12 weeks`;
  }
  const pct = deltaPct === null ? 0 : Math.round(deltaPct * 100);
  const verb = pct === 0 ? "flat" : pct > 0 ? `up ${pct}%` : `down ${Math.abs(pct)}%`;
  return `Trailing 12 weeks ${verb} vs same period last year`;
}

function statusSegments(byStatus: Record<string, number>) {
  return [
    { label: "Active", value: byStatus.active ?? 0, colorClass: "bg-emerald-500" },
    { label: "Won back", value: byStatus.won_back ?? 0, colorClass: "bg-blue-500" },
    { label: "Paused", value: byStatus.paused ?? 0, colorClass: "bg-zinc-500" },
    { label: "Refunded", value: byStatus.refunded ?? 0, colorClass: "bg-amber-500" },
    { label: "Churned", value: byStatus.churned ?? 0, colorClass: "bg-rose-500" },
  ];
}

function RiskCard({
  label,
  pct,
  primary,
  secondary,
}: {
  label: string;
  pct: number;
  primary: string;
  secondary: string;
}) {
  const danger = pct >= CONCENTRATION_DANGER_THRESHOLD;
  return (
    <div
      className={
        danger
          ? "rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"
          : "rounded-lg border border-zinc-800 bg-zinc-950 p-4"
      }
    >
      <div className="flex items-start justify-between">
        <p className="text-xs uppercase tracking-wider text-zinc-400">{label}</p>
        <TrendArrow trend={danger ? "up" : "flat"} deltaPct={pct} invertColors />
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">
        {(pct * 100).toFixed(0)}%
      </p>
      <p className="mt-1 text-sm text-zinc-300">{primary}</p>
      <p className="text-xs text-zinc-500">{secondary}</p>
    </div>
  );
}

function retentionCell(initial: number, retained: number | null): string {
  if (retained === null) return "…";
  if (initial === 0) return "—";
  return `${retained}/${initial} · ${((retained / initial) * 100).toFixed(0)}%`;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
