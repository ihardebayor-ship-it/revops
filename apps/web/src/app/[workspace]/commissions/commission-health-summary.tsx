"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  canRelease,
}: {
  workspaceId: string;
  subAccountId: string | null;
  canRelease: boolean;
}) {
  const router = useRouter();
  const [health, setHealth] = useState<CommissionHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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

  function releaseAvailable() {
    setActionMessage(null);
    setActionError(null);
    startTransition(async () => {
      try {
        const result = await releaseAvailableEntries(workspaceId, subAccountId);
        const next = await fetchCommissionHealth(workspaceId, subAccountId);
        setHealth(next);
        setActionMessage(`Released ${result.released} eligible entries.`);
        router.refresh();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      }
    });
  }

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
          {canRelease && (
            <div className="mt-3 flex flex-col items-start gap-1">
              <button
                type="button"
                onClick={releaseAvailable}
                disabled={pending || health.stalePending === 0}
                className="rounded-md border border-emerald-500/40 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
              >
                {pending ? "Releasing..." : "Release eligible entries"}
              </button>
              {actionMessage && <p className="text-xs text-emerald-400">{actionMessage}</p>}
              {actionError && <p className="text-xs text-red-400">{actionError}</p>}
            </div>
          )}
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

async function releaseAvailableEntries(workspaceId: string, subAccountId: string | null) {
  const res = await fetch("/api/trpc/commissions.releaseAvailable?batch=1", {
    method: "POST",
    headers: trpcHeaders(workspaceId, subAccountId),
    body: JSON.stringify({ "0": { json: null } }),
  });
  const json = (await res.json()) as TrpcBatchResponse<{ released: number }>;
  const message = json[0]?.error?.json?.message ?? json[0]?.error?.message;
  if (!res.ok || message) throw new Error(message ?? `${res.status}: request failed`);
  const result = json[0]?.result?.data?.json;
  if (!result) throw new Error("Empty release response");
  return result;
}

function trpcHeaders(workspaceId: string, subAccountId: string | null): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-workspace-id": workspaceId,
  };
  if (subAccountId) headers["x-sub-account-id"] = subAccountId;
  return headers;
}
