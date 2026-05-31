"use client";

import { useEffect, useState } from "react";
import { Pill, Time } from "@revops/ui";

type WebhookSummary = {
  total: number;
  pending: number;
  processed: number;
  failed: number;
  lastReceivedAt: string | null;
  lastProcessedAt: string | null;
};

type TrpcBatchResponse<T> = Array<{
  result?: { data?: { json?: T } };
  error?: { json?: { message?: string }; message?: string };
}>;

export function WebhookHealthSummary({
  workspaceId,
  subAccountId,
}: {
  workspaceId: string;
  subAccountId: string;
}) {
  const [summary, setSummary] = useState<WebhookSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const next = await fetchWebhookSummary(workspaceId, subAccountId);
        if (!cancelled) setSummary(next);
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
        Webhook health unavailable: {error}
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
        Loading webhook health...
      </div>
    );
  }

  const variant = summary.failed > 0 ? "danger" : summary.pending > 0 ? "warning" : "positive";

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-100">Webhook health</h2>
            <Pill variant={variant}>{summary.failed > 0 ? "attention" : "healthy"}</Pill>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Last {summary.total} scoped events sampled for this sub-account.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-right">
          <Metric label="Pending" value={summary.pending} tone="text-blue-400" />
          <Metric label="Failed" value={summary.failed} tone="text-red-400" />
          <Metric label="Processed" value={summary.processed} tone="text-green-400" />
        </div>
      </div>
      <div className="mt-4 grid gap-2 border-t border-zinc-800 pt-3 text-xs text-zinc-500 md:grid-cols-2">
        <p>
          Last received: {summary.lastReceivedAt ? <Time value={summary.lastReceivedAt} /> : "none"}
        </p>
        <p>
          Last processed:{" "}
          {summary.lastProcessedAt ? <Time value={summary.lastProcessedAt} /> : "none"}
        </p>
      </div>
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

async function fetchWebhookSummary(workspaceId: string, subAccountId: string) {
  const input = encodeURIComponent(JSON.stringify({ "0": { json: { limit: 500 } } }));
  const res = await fetch(`/api/trpc/webhooks.summary?batch=1&input=${input}`, {
    headers: {
      "x-workspace-id": workspaceId,
      "x-sub-account-id": subAccountId,
    },
  });
  const json = (await res.json()) as TrpcBatchResponse<WebhookSummary>;
  const message = json[0]?.error?.json?.message ?? json[0]?.error?.message;
  if (!res.ok || message) throw new Error(message ?? `${res.status}: request failed`);
  return json[0]?.result?.data?.json ?? null;
}
