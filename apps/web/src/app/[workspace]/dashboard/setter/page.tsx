import { and, count, eq, gte, isNull, sql } from "drizzle-orm";
import { withTenant, schema } from "@revops/db/client";
import { PageHeader, Pill, Time } from "@revops/ui";
import { resolveWorkspaceBySlug } from "~/lib/workspace";

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

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [stats, pendingOptins, todaysCalls] = await withTenant(ctx.authCtx, async (db) => {
    const [pendingCount] = await db
      .select({ n: count() })
      .from(schema.optins)
      .where(
        and(
          eq(schema.optins.subAccountId, subId),
          eq(schema.optins.attributedSetterUserId, userId),
          isNull(schema.optins.contactedCallId),
        ),
      );

    const [bookedThisWeek] = await db
      .select({ n: count() })
      .from(schema.calls)
      .where(
        and(
          eq(schema.calls.subAccountId, subId),
          eq(schema.calls.setterUserId, userId),
          gte(schema.calls.createdAt, weekAgo),
          isNull(schema.calls.deletedAt),
        ),
      );

    const [contactedThisWeek] = await db
      .select({ n: count() })
      .from(schema.optins)
      .where(
        and(
          eq(schema.optins.subAccountId, subId),
          eq(schema.optins.attributedSetterUserId, userId),
          gte(schema.optins.contactedAt, weekAgo),
        ),
      );

    const avgRow = await db
      .select({
        avgSeconds: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (contacted_at - submitted_at))), 0)::int`,
      })
      .from(schema.optins)
      .where(
        and(
          eq(schema.optins.subAccountId, subId),
          eq(schema.optins.attributedSetterUserId, userId),
          gte(schema.optins.contactedAt, weekAgo),
        ),
      );
    const avgSeconds = avgRow[0]?.avgSeconds ?? 0;

    const opts = await db
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
          eq(schema.optins.attributedSetterUserId, userId),
          isNull(schema.optins.contactedCallId),
        ),
      )
      .orderBy(schema.optins.submittedAt)
      .limit(10);

    const calls = await db
      .select({
        id: schema.calls.id,
        contactName: schema.calls.contactName,
        contactEmail: schema.calls.contactEmail,
        appointmentAt: schema.calls.appointmentAt,
        showedAt: schema.calls.showedAt,
      })
      .from(schema.calls)
      .where(
        and(
          eq(schema.calls.subAccountId, subId),
          eq(schema.calls.setterUserId, userId),
          gte(schema.calls.createdAt, dayAgo),
          isNull(schema.calls.deletedAt),
        ),
      )
      .orderBy(schema.calls.appointmentAt)
      .limit(10);

    return [
      {
        pendingOptinCount: pendingCount?.n ?? 0,
        bookedThisWeek: bookedThisWeek?.n ?? 0,
        contactedThisWeek: contactedThisWeek?.n ?? 0,
        avgSpeedToLeadSeconds: avgSeconds ?? 0,
      },
      opts,
      calls,
    ];
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Setter dashboard"
        description={`Your speed-to-lead and pipeline for ${ctx.workspace.name}.`}
      />

      <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <StatCard label="Pending opt-ins" value={stats.pendingOptinCount} accent="blue" />
        <StatCard
          label="Avg speed-to-lead (7d)"
          value={formatSeconds(stats.avgSpeedToLeadSeconds)}
        />
        <StatCard label="Contacted (7d)" value={stats.contactedThisWeek} accent="green" />
        <StatCard label="Booked (7d)" value={stats.bookedThisWeek} accent="purple" />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">
          Pending opt-ins · {pendingOptins.length}
        </h2>
        {pendingOptins.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
            No pending opt-ins. The SLA sweep will surface a follow-up task here when one
            arrives and isn't contacted within your workspace's SLA window.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
            {pendingOptins.map((o) => (
              <li key={o.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <Pill variant="warning">PENDING</Pill>
                <span className="flex-1 text-zinc-100">{o.name || o.email}</span>
                <span className="text-xs text-zinc-500">
                  Submitted: <Time value={o.submittedAt} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">
          Today's calls · {todaysCalls.length}
        </h2>
        {todaysCalls.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
            No calls in the last 24 hours.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
            {todaysCalls.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                {c.showedAt ? (
                  <Pill variant="positive">Showed</Pill>
                ) : (
                  <Pill variant="info">Booked</Pill>
                )}
                <a
                  href={`/${slug}/calls/${c.id}`}
                  className="flex-1 text-zinc-100 hover:text-blue-400"
                >
                  {c.contactName || c.contactEmail}
                </a>
                <span className="text-xs text-zinc-500">
                  {c.appointmentAt && <Time value={c.appointmentAt} />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: "blue" | "green" | "purple";
}) {
  const accentClass =
    accent === "blue"
      ? "text-blue-400"
      : accent === "green"
        ? "text-green-400"
        : accent === "purple"
          ? "text-purple-400"
          : "text-zinc-100";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight ${accentClass}`}>{value}</p>
    </div>
  );
}

function formatSeconds(seconds: number): string {
  if (!seconds || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}
