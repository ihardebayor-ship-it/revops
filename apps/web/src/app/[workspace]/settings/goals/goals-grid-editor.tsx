"use client";

// Per-period team grid for goals.
// Differentiators vs typical sales-tool quota editors:
//   1. Hero is the grid, not a form. Manager sees fairness + coverage at a glance.
//   2. Editor drawer shows live "your last 3 actuals were X / Y / Z, this target =
//      117% of avg" while the manager types — calibration without flying blind.
//   3. Server-side period-overlap detection rejects ambiguous quotas at write time.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Period = { from: string; to: string; label: string };

type Cell = {
  userId: string;
  periodStart: string;
  periodEnd: string;
  quota: number | null;
  attained: number;
  attainmentPct: number | null;
  goalId: string | null;
};

type Row = {
  userId: string;
  email: string;
  name: string | null;
  cells: Cell[];
};

type TeamMember = { userId: string; name: string | null; email: string };

type QuotaContext = {
  recentActuals: Array<{ periodStart: string; periodEnd: string; actual: number }>;
  avgRecent: number;
  bestRecent: number;
  lastQuota: { targetValue: number; periodStart: string; periodEnd: string } | null;
};

export function GoalsGridEditor({
  slug,
  periods,
  rows,
  team,
}: {
  slug: string;
  periods: Period[];
  rows: Row[];
  team: TeamMember[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    userId: string;
    period: Period;
    goalId: string | null;
    initialValue: string;
  } | null>(null);

  void slug;

  function openCellEditor(userId: string, period: Period, cell: Cell | null) {
    setEditing({
      userId,
      period,
      goalId: cell?.goalId ?? null,
      initialValue: cell?.quota ? cell.quota.toFixed(2) : "",
    });
  }

  function call(path: string, body: unknown, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const wsId = await fetchWorkspaceId();
      if (!wsId) return setError("No workspace");
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": wsId },
        body: JSON.stringify({ "0": { json: body } }),
      });
      if (!res.ok) {
        const text = await res.text();
        return setError(parseTrpcError(text));
      }
      onDone?.();
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="px-4 py-2 font-medium">Member</th>
              {periods.map((p) => (
                <th key={p.from} className="px-4 py-2 font-medium">
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={periods.length + 1} className="px-4 py-6 text-center text-sm text-zinc-400">
                  No team members yet. Add teammates in Settings → Team.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.userId}>
                  <td className="px-4 py-3">
                    <p className="text-sm text-zinc-100">{r.name || r.email}</p>
                    {r.name && <p className="text-xs text-zinc-500">{r.email}</p>}
                  </td>
                  {r.cells.map((c, i) => (
                    <td key={i} className="px-2 py-2 align-middle">
                      <CellButton
                        cell={c}
                        period={periods[i]!}
                        onClick={() => openCellEditor(r.userId, periods[i]!, c)}
                      />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-500">
        Color: <span className="text-emerald-400">on pace</span> ·{" "}
        <span className="text-blue-400">tracking</span> ·{" "}
        <span className="text-amber-400">behind</span> ·{" "}
        <span className="text-rose-400">at risk</span>. Empty cells = no quota set yet.
      </p>

      {editing && (
        <QuotaDrawer
          slug={slug}
          editing={editing}
          team={team}
          pending={pending}
          onCancel={() => setEditing(null)}
          onSubmit={({ goalId, userId, periodStart, periodEnd, targetValue }) => {
            if (goalId) {
              call(
                "/api/trpc/goals.update?batch=1",
                { goalId, targetValue },
                () => setEditing(null),
              );
            } else {
              call(
                "/api/trpc/goals.create?batch=1",
                {
                  kind: "quota",
                  metric: "booked_amount",
                  targetValue,
                  periodKind: "monthly",
                  periodStart,
                  periodEnd,
                  userId,
                },
                () => setEditing(null),
              );
            }
          }}
          onDelete={
            editing.goalId
              ? () =>
                  call("/api/trpc/goals.softDelete?batch=1", { goalId: editing.goalId }, () =>
                    setEditing(null),
                  )
              : undefined
          }
        />
      )}
    </div>
  );
}

function CellButton({
  cell,
  period,
  onClick,
}: {
  cell: Cell;
  period: Period;
  onClick: () => void;
}) {
  void period;
  if (cell.quota === null) {
    return (
      <button
        onClick={onClick}
        className="w-full rounded-md border border-dashed border-zinc-800 px-3 py-3 text-xs text-zinc-500 hover:border-blue-500 hover:text-blue-400"
      >
        + Quota
      </button>
    );
  }

  const pct = cell.attainmentPct ?? 0;
  const tone =
    pct >= 1
      ? "border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10"
      : pct >= 0.7
        ? "border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10"
        : pct >= 0.4
          ? "border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10"
          : "border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10";

  const fillPct = Math.min(100, Math.max(0, pct * 100));

  return (
    <button
      onClick={onClick}
      className={`block w-full rounded-md border px-3 py-2 text-left transition-colors ${tone}`}
    >
      <p className="text-xs uppercase tracking-wider text-zinc-400">
        {money(cell.quota)} quota
      </p>
      <p className="mt-1 text-sm font-medium text-zinc-100">
        {money(cell.attained)} attained
      </p>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={
            pct >= 1
              ? "h-full bg-emerald-500"
              : pct >= 0.7
                ? "h-full bg-blue-500"
                : pct >= 0.4
                  ? "h-full bg-amber-500"
                  : "h-full bg-rose-500"
          }
          style={{ width: `${fillPct}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        {(pct * 100).toFixed(0)}% attainment
      </p>
    </button>
  );
}

function QuotaDrawer({
  slug,
  editing,
  team,
  pending,
  onCancel,
  onSubmit,
  onDelete,
}: {
  slug: string;
  editing: { userId: string; period: Period; goalId: string | null; initialValue: string };
  team: TeamMember[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (args: {
    goalId: string | null;
    userId: string;
    periodStart: string;
    periodEnd: string;
    targetValue: string;
  }) => void;
  onDelete?: () => void;
}) {
  void slug;
  const [value, setValue] = useState(editing.initialValue);
  const [context, setContext] = useState<QuotaContext | null>(null);
  const [loading, setLoading] = useState(false);
  const member = team.find((m) => m.userId === editing.userId);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const wsId = await fetchWorkspaceId();
        if (!wsId) return;
        const params = encodeURIComponent(
          JSON.stringify({
            "0": { json: { userId: editing.userId, periodKind: "monthly" } },
          }),
        );
        const res = await fetch(
          `/api/trpc/goals.quotaContext?batch=1&input=${params}`,
          { headers: { "x-workspace-id": wsId } },
        );
        if (!res.ok) return;
        const json = (await res.json()) as Array<{
          result?: { data?: { json?: QuotaContext } };
        }>;
        if (!cancelled) setContext(json[0]?.result?.data?.json ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [editing.userId]);

  const numValue = Number(value);
  const isValid = !Number.isNaN(numValue) && numValue > 0;

  const calibration = (() => {
    if (!context || !isValid) return null;
    const lines: Array<{ label: string; pct: number; emphasis: "high" | "low" | "neutral" }> = [];
    if (context.avgRecent > 0) {
      const pct = numValue / context.avgRecent;
      lines.push({
        label: `${(pct * 100).toFixed(0)}% of last 3-month avg (${money(context.avgRecent)})`,
        pct,
        emphasis: pct > 1.3 ? "high" : pct < 0.8 ? "low" : "neutral",
      });
    }
    if (context.bestRecent > 0) {
      const pct = numValue / context.bestRecent;
      lines.push({
        label: `${(pct * 100).toFixed(0)}% of best recent month (${money(context.bestRecent)})`,
        pct,
        emphasis: pct > 1.2 ? "high" : pct < 0.7 ? "low" : "neutral",
      });
    }
    if (context.lastQuota) {
      const pct = numValue / context.lastQuota.targetValue;
      lines.push({
        label: `${(pct * 100).toFixed(0)}% of last quota (${money(context.lastQuota.targetValue)})`,
        pct,
        emphasis: pct > 1.2 ? "high" : pct < 0.8 ? "low" : "neutral",
      });
    }
    return lines;
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="flex h-full w-full max-w-md flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <p className="text-xs uppercase tracking-wider text-zinc-400">
            {editing.goalId ? "Edit quota" : "Set quota"} · {editing.period.label}
          </p>
          <h3 className="mt-1 text-lg font-semibold text-zinc-100">
            {member?.name || member?.email || "Member"}
          </h3>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-zinc-400">
            Quota target (USD)
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="50000"
            autoFocus
            className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
          />
        </label>

        <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
          <p className="text-xs uppercase tracking-wider text-zinc-400">Calibration</p>
          {loading ? (
            <p className="mt-2 text-xs text-zinc-500">Loading recent attainment…</p>
          ) : context ? (
            <>
              <ul className="mt-2 flex flex-col gap-1 text-xs text-zinc-300">
                {context.recentActuals.map((a, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="text-zinc-500">{a.periodStart.slice(0, 7)}</span>
                    <span>{money(a.actual)}</span>
                  </li>
                ))}
              </ul>
              {calibration && calibration.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1 text-xs">
                  {calibration.map((c, i) => (
                    <li
                      key={i}
                      className={
                        c.emphasis === "high"
                          ? "text-amber-400"
                          : c.emphasis === "low"
                            ? "text-rose-400"
                            : "text-zinc-300"
                      }
                    >
                      {c.label}
                    </li>
                  ))}
                </ul>
              )}
              {!isValid && (
                <p className="mt-2 text-xs text-zinc-500">
                  Type a target value to see how it compares.
                </p>
              )}
            </>
          ) : (
            <p className="mt-2 text-xs text-zinc-500">No prior data for this rep.</p>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2">
          {onDelete ? (
            <button
              onClick={onDelete}
              disabled={pending}
              className="rounded-md border border-red-500/30 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-30"
            >
              Remove quota
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              disabled={pending}
              className="rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-30"
            >
              Cancel
            </button>
            <button
              onClick={() =>
                onSubmit({
                  goalId: editing.goalId,
                  userId: editing.userId,
                  periodStart: editing.period.from,
                  periodEnd: previousDay(editing.period.to),
                  targetValue: numValue.toFixed(2),
                })
              }
              disabled={pending || !isValid}
              className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-30"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function previousDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function money(v: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v);
}

function parseTrpcError(text: string): string {
  // Unwrap the standard tRPC error shape; fall back to a slice of raw text.
  try {
    const j = JSON.parse(text);
    const msg =
      j?.[0]?.error?.json?.message ?? j?.error?.json?.message ?? j?.error?.message;
    if (typeof msg === "string") return msg;
  } catch {
    /* not JSON */
  }
  return text.slice(0, 200);
}

async function fetchWorkspaceId(): Promise<string | null> {
  const res = await fetch(
    "/api/trpc/me?batch=1&input=" + encodeURIComponent(JSON.stringify({ "0": {} })),
  );
  const json = await res.json();
  return json?.[0]?.result?.data?.json?.workspaceId ?? null;
}
