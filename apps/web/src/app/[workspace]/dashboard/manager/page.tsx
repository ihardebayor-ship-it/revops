// Manager dashboard — insight-first.
// Hero question: "Is my team going to hit, and who needs coaching?"
//
// Layout:
//   1. Hero ForecastCard: team-wide attainment + forecast vs combined quotas
//   2. Three MetricCards: pipeline coverage, speed-to-lead breach, refund rate
//   3. Leaderboard: per-rep ranked + WoW trend + coaching markers
//   4. SLA dashboard
//   5. Anomaly feed (auto-detected WoW shifts)

import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
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
  TrendArrow,
} from "@revops/ui";
import { resolveWorkspaceBySlug } from "~/lib/workspace";

export default async function ManagerDashboardPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);
  const subId = ctx.membership.subAccountId;
  const isAdmin =
    ctx.membership.accessRole === "workspace_admin" ||
    ctx.membership.accessRole === "sub_account_admin" ||
    ctx.membership.accessRole === "manager" ||
    ctx.authCtx.isSuperadmin;

  if (!subId) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Manager dashboard" description="No sub-account context." />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title="Manager dashboard"
          description="This view is for managers and admins."
        />
      </div>
    );
  }

  const period = analytics.currentMonth();
  const prevPeriod = analytics.previousPeriod(period);

  const data = await withTenant(ctx.authCtx, async (db) => {
    // Team-wide quota: sum of every active per-user quota for this period.
    const quotaRows = await db
      .select({
        target: sql<number>`coalesce(sum(${schema.goals.targetValue}), 0)::float`,
      })
      .from(schema.goals)
      .where(
        and(
          eq(schema.goals.workspaceId, ctx.workspace.id),
          eq(schema.goals.kind, "quota"),
          isNull(schema.goals.deletedAt),
          sql`${schema.goals.periodStart} <= ${period.to.toISOString().slice(0, 10)}`,
          sql`${schema.goals.periodEnd} >= ${period.from.toISOString().slice(0, 10)}`,
        ),
      );
    const teamQuota = quotaRows[0]?.target ?? 0;

    const [teamAttainment, prevTeamAttainment, board, pipeline, speedThisWeek, bookedSeries] =
      await Promise.all([
        analytics.attainment(db, {
          workspaceId: ctx.workspace.id,
          subAccountId: subId,
          quota: teamQuota,
          period,
        }),
        analytics.attainment(db, {
          workspaceId: ctx.workspace.id,
          subAccountId: subId,
          quota: teamQuota,
          period: prevPeriod,
        }),
        analytics.leaderboard(db, {
          workspaceId: ctx.workspace.id,
          subAccountId: subId,
          period,
        }),
        analytics.pipelineHealth(db, {
          workspaceId: ctx.workspace.id,
          subAccountId: subId,
        }),
        analytics.speedToLead(db, {
          workspaceId: ctx.workspace.id,
          subAccountId: subId,
          period: { from: new Date(Date.now() - 7 * 24 * 3600 * 1000), to: new Date() },
        }),
        analytics.bookedAmountSeries(db, {
          workspaceId: ctx.workspace.id,
          subAccountId: subId,
          period: { from: new Date(Date.now() - 30 * 24 * 3600 * 1000), to: new Date() },
        }),
      ]);

    // Refund rate, team-wide last 30d.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const [refunds] = await db
      .select({
        total: sql<number>`count(*)::int`,
        refunded: sql<number>`count(*) filter (where ${schema.sales.refundStatus} = 'issued')::int`,
      })
      .from(schema.sales)
      .where(
        and(
          eq(schema.sales.workspaceId, ctx.workspace.id),
          eq(schema.sales.subAccountId, subId),
          isNull(schema.sales.deletedAt),
          gte(schema.sales.closedAt, thirtyDaysAgo),
        ),
      );

    // Unlinked sales (workspace-wide).
    const [unlinkedRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.sales)
      .where(
        and(
          eq(schema.sales.workspaceId, ctx.workspace.id),
          eq(schema.sales.subAccountId, subId),
          isNull(schema.sales.linkedCallId),
          isNull(schema.sales.deletedAt),
        ),
      );

    return {
      teamQuota,
      teamAttainment,
      prevTeamAttainment,
      board,
      pipeline,
      speedThisWeek,
      bookedSeries,
      refunds,
      unlinkedCount: unlinkedRow?.n ?? 0,
    };
  });

  const teamCmp = analytics.compareMetrics(
    data.teamAttainment.attained,
    data.prevTeamAttainment.attained || null,
  );
  const refundRate =
    data.refunds && data.refunds.total > 0 ? data.refunds.refunded / data.refunds.total : null;

  // Anomaly: detect on the booked-series last point vs prior 14 days.
  const bookedAnomaly = analytics.detectAnomaly({
    series: data.bookedSeries,
    baselineSize: 14,
    zThreshold: 2,
  });

  const coachingAlerts = data.board.flatMap((rep) => {
    const alerts: { rep: string; reason: string; severity: "warning" | "danger" }[] = [];
    if (rep.attainmentTrend === "down" && rep.attainmentDeltaPct !== null && rep.attainmentDeltaPct < -0.2) {
      alerts.push({
        rep: rep.name || rep.email,
        reason: `attainment dropped ${(rep.attainmentDeltaPct * -100).toFixed(0)}% vs last period`,
        severity: "danger",
      });
    }
    if (rep.attained > 0 && rep.pipelineCount === 0) {
      alerts.push({
        rep: rep.name || rep.email,
        reason: "active rep with empty pipeline — book them in",
        severity: "warning",
      });
    }
    if (rep.vsMedian !== null && rep.vsMedian < 0.4 && rep.attained > 0) {
      alerts.push({
        rep: rep.name || rep.email,
        reason: `tracking <40% of team median — coach`,
        severity: "warning",
      });
    }
    return alerts;
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Manager"
        description={`${ctx.workspace.name} · ${monthLabel(period.from)} · ${data.board.length} active reps`}
      />

      {data.teamQuota > 0 ? (
        <ForecastCard
          headline={teamForecastHeadline(data.teamAttainment)}
          status={data.teamAttainment.status}
          primaryValue={
            <Money amount={data.teamAttainment.attained.toFixed(2)} currency="USD" />
          }
          primaryLabel={`of ${money(data.teamQuota, "USD")} team quota · ${data.teamAttainment.daysRemaining} days left`}
          secondaryValue={
            <Money amount={data.teamAttainment.forecastEnd.toFixed(2)} currency="USD" />
          }
          secondaryLabel="forecast end-of-month"
          progressPct={data.teamAttainment.attainmentPct}
          paceMark={data.teamAttainment.daysElapsed / Math.max(1, data.teamAttainment.totalDays)}
          footnote={teamFootnote(data.teamAttainment)}
        />
      ) : (
        <ForecastCard
          headline="No team quotas configured"
          status="on_pace"
          primaryValue={
            <Money amount={data.teamAttainment.attained.toFixed(2)} currency="USD" />
          }
          primaryLabel="team booked this month"
          progressPct={0}
          footnote="Set per-rep quotas in goals so the forecast lights up."
        />
      )}

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard
          label="Team booked"
          value={<Money amount={data.teamAttainment.attained.toFixed(2)} currency="USD" />}
          trend={teamCmp.trend}
          deltaPct={teamCmp.deltaPct}
          series={data.bookedSeries.map((p) => p.value)}
          sparklineTone={
            teamCmp.trend === "up" ? "emerald" : teamCmp.trend === "down" ? "rose" : "blue"
          }
          comparison={
            teamCmp.previous !== null ? `prev ${money(teamCmp.previous, "USD")}` : "first period"
          }
        />
        <MetricCard
          label="Pipeline coverage"
          value={
            data.pipeline.coverageRatio !== null
              ? `${data.pipeline.coverageRatio.toFixed(1)}×`
              : `${data.pipeline.totalCallCount} upcoming`
          }
          comparison={
            data.pipeline.weightedPipelineValue > 0
              ? `${money(data.pipeline.weightedPipelineValue, "USD")} weighted`
              : "no weighted pipeline"
          }
        />
        <MetricCard
          label="Refund rate (30d)"
          value={refundRate !== null ? `${(refundRate * 100).toFixed(1)}%` : "—"}
          comparison={
            data.refunds
              ? `${data.refunds.refunded} of ${data.refunds.total} sales`
              : undefined
          }
          invertColors
        />
      </section>

      {/* Anomaly callout */}
      {bookedAnomaly.isAnomaly && (
        <section
          className={`rounded-lg border p-4 ${
            bookedAnomaly.direction === "down"
              ? "border-rose-500/30 bg-rose-500/5"
              : "border-emerald-500/30 bg-emerald-500/5"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <p
              className={`text-sm font-semibold ${
                bookedAnomaly.direction === "down" ? "text-rose-400" : "text-emerald-400"
              }`}
            >
              {bookedAnomaly.direction === "down"
                ? "Anomaly: team booked dropped sharply today"
                : "Anomaly: team booked spiked today"}
            </p>
            <span className="text-xs text-zinc-500">
              z-score {bookedAnomaly.zScore.toFixed(1)} · baseline avg{" "}
              {money(bookedAnomaly.historicalMean, "USD")}
            </span>
          </div>
        </section>
      )}

      {/* Leaderboard */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">
          Leaderboard · {data.board.length}
        </h2>
        {data.board.length === 0 ? (
          <EmptyState
            title="No active reps."
            description="Reps appear here once they book or close in this period."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Rep</th>
                  <th className="px-4 py-2 text-right font-medium">Booked</th>
                  <th className="px-4 py-2 text-right font-medium">vs last</th>
                  <th className="px-4 py-2 text-right font-medium">vs median</th>
                  <th className="px-4 py-2 text-right font-medium">Closes</th>
                  <th className="px-4 py-2 text-right font-medium">Pipeline</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {data.board.map((rep, i) => (
                  <tr key={rep.userId} className="hover:bg-zinc-900/50">
                    <td className="px-4 py-3">
                      <span className="mr-2 text-xs text-zinc-500">#{i + 1}</span>
                      <span className="text-zinc-100">{rep.name || rep.email}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-100">
                      <Money amount={rep.attained.toFixed(2)} currency="USD" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <TrendArrow trend={rep.attainmentTrend} deltaPct={rep.attainmentDeltaPct} />
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-400">
                      {rep.vsMedian !== null
                        ? `${(rep.vsMedian * 100).toFixed(0)}%`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-400">{rep.closesCount}</td>
                    <td className="px-4 py-3 text-right text-zinc-400">{rep.pipelineCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Coaching alerts */}
      {coachingAlerts.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-zinc-300">
            Coaching alerts · {coachingAlerts.length}
          </h2>
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
            {coachingAlerts.map((a, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3 text-sm">
                <Pill variant={a.severity === "danger" ? "danger" : "warning"}>
                  {a.severity}
                </Pill>
                <span className="font-medium text-zinc-100">{a.rep}</span>
                <span className="flex-1 text-zinc-400">{a.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* SLA dashboard */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h2 className="mb-3 text-sm font-medium text-zinc-300">Service-level health</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <SlaCell
            label="Speed-to-lead"
            value={
              data.speedThisWeek.medianSeconds !== null
                ? formatDuration(data.speedThisWeek.medianSeconds)
                : "—"
            }
            secondary={
              data.speedThisWeek.contactedCount > 0
                ? `${data.speedThisWeek.breachCount} of ${data.speedThisWeek.contactedCount} over SLA`
                : "no contacts logged"
            }
            healthy={(data.speedThisWeek.breachRatePct ?? 0) < 0.1}
          />
          <SlaCell
            label="Uncontacted optins"
            value={data.speedThisWeek.uncontactedCount.toString()}
            secondary={
              data.speedThisWeek.uncontactedCount > 0
                ? "queue depth growing"
                : "queue at zero — clean"
            }
            healthy={data.speedThisWeek.uncontactedCount < 5}
          />
          <SlaCell
            label="Unlinked sales"
            value={data.unlinkedCount.toString()}
            secondary={
              data.unlinkedCount > 0
                ? "reconcile via the unlinked sales view"
                : "every sale has a call"
            }
            healthy={data.unlinkedCount === 0}
          />
        </div>
      </section>

      {/* Booked timeline footer */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-300">Daily booked (30d)</h2>
          <span className="text-xs text-zinc-500">
            Total{" "}
            <Money
              amount={data.bookedSeries
                .reduce((acc, p) => acc + p.value, 0)
                .toFixed(2)}
              currency="USD"
            />
          </span>
        </div>
        <Sparkline
          values={data.bookedSeries.map((p) => p.value)}
          width={520}
          height={48}
          tone={bookedAnomaly.direction === "down" ? "rose" : "emerald"}
        />
      </section>
    </div>
  );
}

function SlaCell({
  label,
  value,
  secondary,
  healthy,
}: {
  label: string;
  value: string;
  secondary: string;
  healthy: boolean;
}) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-zinc-500">{label}</span>
        <span className={`h-2 w-2 rounded-full ${healthy ? "bg-emerald-500" : "bg-amber-500"}`} />
      </div>
      <p className="mt-1 text-xl font-semibold text-zinc-100">{value}</p>
      <p className="text-xs text-zinc-500">{secondary}</p>
    </div>
  );
}

function teamForecastHeadline(a: analytics.AttainmentResult): string {
  if (a.quota === 0) return "Tracking";
  const pct = Math.round((a.forecastEnd / a.quota) * 100);
  if (a.status === "ahead") return `Team forecast ${pct}% of quota — ahead of pace`;
  if (a.status === "on_pace") return `Team forecast ${pct}% of quota — on pace`;
  if (a.status === "behind") return `Team forecast ${pct}% of quota — behind pace`;
  return `Team forecast ${pct}% of quota — at risk`;
}

function teamFootnote(a: analytics.AttainmentResult): string {
  if (a.quota === 0) return "No team quotas active.";
  if (a.status === "ahead") {
    return `Above pace — projected ${money(a.forecastEnd - a.quota, "USD")} above team quota.`;
  }
  if (a.daysRemaining === 0) {
    return `Period closed. Final team attainment ${(a.attainmentPct * 100).toFixed(0)}%.`;
  }
  if (a.requiredDailyRunRate <= 0) {
    return `${a.daysRemaining} days left. Quota covered.`;
  }
  return `Team needs ${money(a.requiredDailyRunRate, "USD")}/day across all reps to hit quota.`;
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

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}
