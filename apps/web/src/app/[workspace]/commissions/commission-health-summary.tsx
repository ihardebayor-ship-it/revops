"use client";

import { useEffect, useState } from "react";
import { Pill, Time } from "@revops/ui";

type CommissionHealth = {
  active: number;
  stalePending: number;
  missingExplanation: number;
  latestRecomputeAt: string | null;
  recentRuns: Array<{
    id: string;
    runAt: string;
    entryCount: number;
    voidedCount: number;
    durationMs: number | null;
    error: string | null;
    triggeredBy: string | null;
  }>;
};

type TrpcBatchResponse<T> = Array<{
  result?: { data?: { json?: T } };
  error?: { json?: { message?: string }; message?: string };
}>;

export function CommissionHealthSummary({
  workspaceId,
  subAccountId,
}: {
  workspaceId: string;
  subAccountId: string | null;
}) {
  const [health, setHealth] = useState<CommissionHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const next = await fetchCommissionHealth(workspaceId, subAccountId);
        if (!cancelled) setHealth(next);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, subAccountId]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
        Commission health unavailable: {error}
      </div>
    );
  }

  if (!health) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
        Loading commission health...
      </div>
    );
  }

  const failedRuns = health.recentRuns.filter((run) => run.error).length;
  const needsAttention = health.stalePending > 0 || health.missingExplanation > 0 || failedRuns > 0;

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-100">Ledger health</h2>
            <Pill variant={needsAttention ? "warning" : "positive"}>
              {needsAttention ? "attention" : "healthy"}
            </Pill>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Scoped to {subAccountId ? "this sub-account" : "this workspace"}. Latest recompute:{" "}
            {health.latestRecomputeAt ? <Time value={health.latestRecomputeAt} /> : "none"}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-right">
          <Metric label="Active" value={health.active} tone="text-zinc-100" />
          <Metric label="Stale pending" value={health.stalePending} tone="text-amber-400" />
          <Metric label="Missing explain" value={health.missingExplanation} tone="text-red-400" />
        </div>
      </div>

      {health.recentRuns.length > 0 && (
        <div className="mt-4 border-t border-zinc-800 pt-3">
          <p className="mb-2 text-xs uppercase tracking-wider text-zinc-500">
            Recent recompute runs
          </p>
          <div className="grid gap-2 text-xs text-zinc-500 md:grid-cols-2">
            {health.recentRuns.slice(0, 2).map((run) => (
              <p key={run.id}>
                <Time value={run.runAt} /> - {run.entryCount} entries - {run.voidedCount} voided
                {run.error ? <span className="text-red-400"> - failed</span> : null}
              </p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <p className={`text-lg font-semibold ${tone}`}>{value}</p>
      <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
    </div>
  );
}

async function fetchCommissionHealth(workspaceId: string, subAccountId: string | null) {
  const res = await fetch("/api/trpc/commissions.health?batch=1", {
    headers: trpcHeaders(workspaceId, subAccountId),
  });
  const json = (await res.json()) as TrpcBatchResponse<CommissionHealth>;
  const message = json[0]?.error?.json?.message ?? json[0]?.error?.message;
  if (!res.ok || message) throw new Error(message ?? `${res.status}: request failed`);
  const health = json[0]?.result?.data?.json;
  if (!health) throw new Error("Empty commission health response");
  return health;
}

function trpcHeaders(workspaceId: string, subAccountId: string | null): HeadersInit {
  const headers: Record<string, string> = { "x-workspace-id": workspaceId };
  if (subAccountId) headers["x-sub-account-id"] = subAccountId;
  return headers;
}
