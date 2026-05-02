// Setter dashboard — insight-first.
// Hero question: "Am I booking quality leads that will show?"
//
// Layout:
//   1. Hero card: speed-to-lead median + breach rate (the setter's #1 KPI)
//   2. Three MetricCards: bookings (week), show rate, no-show rate
//   3. Hot leads needing contact (uncontacted optins past SLA)
//   4. Forward credit: upcoming appointments × expected close rate × avg sale
//   5. Earnings ticker (commission pipeline timeline)

import { and, asc, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
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

const SLA_DEFAULT_SECONDS = 300; // 5 min

export default async function SetterDashboardPage({
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
        <PageHeader title="Setter dashboard" description="No sub-account context." />
      </div>
    );
  }

  // Setter's KPI windows:
  //   speed-to-lead, bookings, show rate → last 7 days
  //   forward credit → next 14 days
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const twoWeeksAhead = new Date(Date.now() + 14 * 24 * 3600 * 1000);

  const data = await withTenant(ctx.authCtx, async (db) => {
    const speedThisWeek = await analytics.speedToLead(db, {
      workspaceId: ctx.workspace.id,
      subAccountId: subId,
      period: { from: weekAgo, to: new Date() },
      slaSeconds: SLA_DEFAULT_SECONDS,
    });
    const speedLastWeek = await analytics.speedToLead(db, {
      workspaceId: ctx.workspace.id,
      subAccountId: subId,
      period: { from: twoWeeksAgo, to: weekAgo },
      slaSeconds: SLA_DEFAULT_SECONDS,
    });

    // Bookings: appointments scheduled by this user (setterUserId on calls).
    const [thisWeekBookings] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.calls)
      .where(
        and(
          eq(schema.calls.subAccountId, subId),
          eq(schema.calls.setterUserId, userId),
          isNotNull(schema.calls.appointmentAt),
          gte(schema.calls.createdAt, weekAgo),
          isNull(schema.calls.deletedAt),
        ),
      );
    const [lastWeekBookings] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.calls)
      .where(
        and(
          eq(schema.calls.subAccountId, subId),
          eq(schema.calls.setterUserId, userId),
          isNotNull(schema.calls.appointmentAt),
          gte(schema.calls.createdAt, twoWeeksAgo),
          lte(schema.calls.createdAt, weekAgo),
          isNull(schema.calls.deletedAt),
        ),
      );

    // Show rate (this week): showed / scheduled. Both windows.
    const [showsThisWeek] = await db
      .select({
        scheduled: sql<number>`count(*)::int`,
        showed: sql<number>`count(*) filter (where ${schema.calls.showedAt} is not null)::int`,
        noShowed: sql<number>`count(*) filter (where ${schema.dispositions.category} = 'no_show')::int`,
      })
      .from(schema.calls)
      .leftJoin(
        schema.dispositions,
        eq(schema.dispositions.id, schema.calls.dispositionId),
      )
      .where(
        and(
          eq(schema.calls.subAccountId, subId),
          eq(schema.calls.setterUserId, userId),
          isNotNull(schema.calls.appointmentAt),
          gte(schema.calls.appointmentAt, weekAgo),
          lte(schema.calls.appointmentAt, new Date()),
          isNull(schema.calls.deletedAt),
        ),
      );

    // Forward credit: appointments booked in next 14 days × historical
    // close rate × avg deal size × setter share. We pull setter's role
    // share from the workspace defaults if any commission_recipients
    // already exist, else assume 0.20.
    const [pipelineRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.calls)
      .where(
        and(
          eq(schema.calls.subAccountId, subId),
          eq(schema.calls.setterUserId, userId),
          isNotNull(schema.calls.appointmentAt),
          gte(schema.calls.appointmentAt, new Date()),
          lte(schema.calls.appointmentAt, twoWeeksAhead),
          isNull(schema.calls.deletedAt),
        ),
      );
    const upcomingAppts = pipelineRow?.n ?? 0;

    // Setter's typical share: median of past commission_recipients rows for this user.
    const [setterShareRow] = await db
      .select({
        share: sql<number>`coalesce(percentile_cont(0.5) within group (order by share_pct), 0)::float`,
      })
      .from(schema.commissionRecipients)
      .where(
        and(
          eq(schema.commissionRecipients.userId, userId),
          eq(schema.commissionRecipients.workspaceId, ctx.workspace.id),
          isNull(schema.commissionRecipients.deletedAt),
        ),
      );
    const setterShare = setterShareRow?.share ?? 0.2;

    // Historical close rate + avg deal: from pipeline analytics for the workspace.
    const wsPipeline = await analytics.pipelineHealth(db, {
      workspaceId: ctx.workspace.id,
      subAccountId: subId,
    });
    const expectedCredit =
      upcomingAppts * wsPipeline.avgDealSize * wsPipeline.historicalCloseRate * setterShare;

    // Hot leads needing contact: optins past SLA without contactedAt.
    const slaCutoff = new Date(Date.now() - SLA_DEFAULT_SECONDS * 1000);
    const hotLeads = await db
      .select({
        id: schema.optins.id,
        email: schema.optins.email,
        name: schema.optins.name,
        submittedAt: schema.optins.submittedAt,
      })
      .from(schema.optins)
      .where(
        and(
          eq(schema.optins.subAccountId, subId),
          lte(schema.optins.submittedAt, slaCutoff),
          isNull(schema.optins.contactedAt),
        ),
      )
      .orderBy(asc(schema.optins.submittedAt))
      .limit(8);

    const commissionPipelineSeries = await analytics.commissionAvailableSeries(db, {
      workspaceId: ctx.workspace.id,
      subAccountId: subId,
      userId,
      period: { from: new Date(), to: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
    });

    const bookingsSeries = await db
      .select({
        bucket: sql<string>`date_trunc('day', created_at)::date::text`,
        value: sql<number>`count(*)::int`,
      })
      .from(schema.calls)
      .where(
        and(
          eq(schema.calls.subAccountId, subId),
          eq(schema.calls.setterUserId, userId),
          gte(schema.calls.createdAt, new Date(Date.now() - 14 * 24 * 3600 * 1000)),
          isNotNull(schema.calls.appointmentAt),
          isNull(schema.calls.deletedAt),
        ),
      )
      .groupBy(sql`date_trunc('day', created_at)::date`)
      .orderBy(sql`date_trunc('day', created_at)::date`);

    return {
      speedThisWeek,
      speedLastWeek,
      thisWeekBookings: thisWeekBookings?.n ?? 0,
      lastWeekBookings: lastWeekBookings?.n ?? 0,
      showsThisWeek,
      upcomingAppts,
      setterShare,
      avgDealSize: wsPipeline.avgDealSize,
      historicalCloseRate: wsPipeline.historicalCloseRate,
      expectedCredit,
      hotLeads,
      commissionPipelineSeries,
      bookingsSeries: bookingsSeries.map((r) => r.value),
    };
  });

  const speedCmp = analytics.compareMetrics(
    data.speedThisWeek.medianSeconds ?? 0,
    data.speedLastWeek.medianSeconds ?? null,
  );
  const bookingsCmp = analytics.compareMetrics(data.thisWeekBookings, data.lastWeekBookings || null);
  const showRate =
    data.showsThisWeek && data.showsThisWeek.scheduled > 0
      ? data.showsThisWeek.showed / data.showsThisWeek.scheduled
      : null;
  const noShowRate =
    data.showsThisWeek && data.showsThisWeek.scheduled > 0
      ? data.showsThisWeek.noShowed / data.showsThisWeek.scheduled
      : null;

  const speedHero = speedHeroFromMetric(data.speedThisWeek);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Setter"
        description={`${ctx.workspace.name} · last 7 days · SLA ${SLA_DEFAULT_SECONDS}s`}
      />

      <ForecastCard
        headline={speedHero.headline}
        status={speedHero.status}
        primaryValue={
          data.speedThisWeek.medianSeconds !== null
            ? formatDuration(data.speedThisWeek.medianSeconds)
            : "—"
        }
        primaryLabel="median time-to-contact"
        secondaryValue={
          data.speedThisWeek.contactedCount > 0
            ? `${data.speedThisWeek.breachCount} breaches`
            : "no contacts logged"
        }
        secondaryLabel="vs SLA"
        progressPct={
          data.speedThisWeek.contactedCount > 0
            ? Math.max(0, 1 - (data.speedThisWeek.breachRatePct ?? 0))
            : 0
        }
        footnote={speedHero.footnote}
      />

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard
          label="Bookings (7d)"
          value={data.thisWeekBookings.toString()}
          trend={bookingsCmp.trend}
          deltaPct={bookingsCmp.deltaPct}
          series={data.bookingsSeries}
          sparklineTone={
            bookingsCmp.trend === "up"
              ? "emerald"
              : bookingsCmp.trend === "down"
                ? "rose"
                : "blue"
          }
          comparison={
            bookingsCmp.previous !== null
              ? `prev week ${bookingsCmp.previous}`
              : "first week"
          }
        />
        <MetricCard
          label="Show rate (7d)"
          value={showRate !== null ? `${(showRate * 100).toFixed(0)}%` : "—"}
          comparison={
            data.showsThisWeek
              ? `${data.showsThisWeek.showed} of ${data.showsThisWeek.scheduled} scheduled`
              : undefined
          }
        />
        <MetricCard
          label="No-show rate (7d)"
          value={noShowRate !== null ? `${(noShowRate * 100).toFixed(0)}%` : "—"}
          comparison={
            data.showsThisWeek?.noShowed
              ? `${data.showsThisWeek.noShowed} no-shows`
              : "no no-shows"
          }
          invertColors
        />
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-300">
            Forward credit (next 14 days)
          </h2>
          <span className="text-base font-semibold text-emerald-400">
            <Money amount={data.expectedCredit.toFixed(2)} currency="USD" />
          </span>
        </div>
        <p className="text-xs text-zinc-400">
          {data.upcomingAppts} upcoming appointments × {(data.historicalCloseRate * 100).toFixed(0)}%
          historical close rate × avg deal{" "}
          <Money amount={data.avgDealSize.toFixed(0)} currency="USD" /> ×{" "}
          {(data.setterShare * 100).toFixed(0)}% your share = expected commission credit
          if every booking shows + closes at the workspace's typical rate.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">
          Hot leads · {data.hotLeads.length}
        </h2>
        {data.hotLeads.length === 0 ? (
          <EmptyState
            title="No hot leads waiting."
            description="Every optin past the SLA has been contacted."
          />
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
            {data.hotLeads.map((l) => {
              const ageMin = Math.floor((Date.now() - new Date(l.submittedAt).getTime()) / 60000);
              return (
                <li key={l.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <Pill variant={ageMin > 30 ? "danger" : "warning"}>
                    {ageMin}m old
                  </Pill>
                  <span className="flex-1 text-zinc-100">{l.name || l.email}</span>
                  <span className="text-xs text-zinc-500">
                    submitted <Time value={l.submittedAt} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-300">Commission release timeline (30d)</h2>
          <span className="text-xs text-zinc-500">
            Total{" "}
            <Money
              amount={data.commissionPipelineSeries
                .reduce((acc, p) => acc + p.value, 0)
                .toFixed(2)}
              currency="USD"
            />
          </span>
        </div>
        <Sparkline
          values={data.commissionPipelineSeries.map((p) => p.value)}
          width={520}
          height={48}
          tone="emerald"
        />
      </section>
    </div>
  );
}

function speedHeroFromMetric(m: analytics.SpeedResult): {
  headline: string;
  status: "ahead" | "on_pace" | "behind" | "at_risk";
  footnote: string;
} {
  if (m.contactedCount === 0) {
    return {
      headline: "No contacts logged this week",
      status: "on_pace",
      footnote: "Contact times need to be recorded for SLA tracking to work.",
    };
  }
  const breachPct = m.breachRatePct ?? 0;
  if (breachPct < 0.05) {
    return {
      headline: `Speed-to-lead is excellent — ${(breachPct * 100).toFixed(0)}% breach rate`,
      status: "ahead",
      footnote: `Median ${formatDuration(m.medianSeconds ?? 0)}, p90 ${formatDuration(m.p90Seconds ?? 0)}. Keep doing what you're doing.`,
    };
  }
  if (breachPct < 0.15) {
    return {
      headline: `Speed-to-lead on pace — ${(breachPct * 100).toFixed(0)}% over SLA`,
      status: "on_pace",
      footnote: `${m.breachCount} of ${m.contactedCount} contacts exceeded the ${m.slaSeconds}s SLA.`,
    };
  }
  if (breachPct < 0.3) {
    return {
      headline: `Speed-to-lead slipping — ${(breachPct * 100).toFixed(0)}% over SLA`,
      status: "behind",
      footnote: `Fast contacts convert ~2× higher. ${m.uncontactedCount} optins still uncontacted.`,
    };
  }
  return {
    headline: `Speed-to-lead at risk — ${(breachPct * 100).toFixed(0)}% over SLA`,
    status: "at_risk",
    footnote: `${m.breachCount} breaches this week + ${m.uncontactedCount} optins still uncontacted. Top of the list, fastest.`,
  };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}
