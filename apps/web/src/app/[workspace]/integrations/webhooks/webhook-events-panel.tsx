"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EmptyState, Pill, Time } from "@revops/ui";

type WebhookStatus = "pending" | "processed" | "failed";
type WebhookSource = "gohighlevel" | "aircall" | "fathom";

type InboundWebhookEvent = {
  id: string;
  source: string;
  providerAccountId: string;
  externalId: string;
  receivedAt: string;
  signatureVerified: boolean;
  processedAt: string | null;
  error: string | null;
  status: WebhookStatus;
};

type TrpcBatchResponse<T> = Array<{
  result?: { data?: { json?: T } };
  error?: { json?: { message?: string }; message?: string };
}>;

const SOURCES: Array<{ value: WebhookSource; label: string }> = [
  { value: "gohighlevel", label: "GoHighLevel" },
  { value: "aircall", label: "Aircall" },
  { value: "fathom", label: "Fathom" },
];

const STATUSES: Array<{ value: WebhookStatus; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
  { value: "processed", label: "Processed" },
];

export function WebhookEventsPanel({
  workspaceId,
  subAccountId,
}: {
  workspaceId: string;
  subAccountId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [source, setSource] = useState<WebhookSource | "">("");
  const [status, setStatus] = useState<WebhookStatus | "">("");
  const [events, setEvents] = useState<InboundWebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replayingId, setReplayingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const rows = await listInboundWebhooks({ workspaceId, subAccountId, source, status });
        if (!cancelled) setEvents(rows);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, subAccountId, source, status]);

  function replay(inboundEventId: string) {
    setError(null);
    setReplayingId(inboundEventId);
    startTransition(async () => {
      try {
        await replayInboundWebhook({ workspaceId, subAccountId, inboundEventId });
        const rows = await listInboundWebhooks({ workspaceId, subAccountId, source, status });
        setEvents(rows);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setReplayingId(null);
      }
    });
  }

  const counts = {
    pending: events.filter((event) => event.status === "pending").length,
    failed: events.filter((event) => event.status === "failed").length,
    processed: events.filter((event) => event.status === "processed").length,
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        <StatusCard label="Pending" value={counts.pending} tone="info" />
        <StatusCard label="Failed" value={counts.failed} tone="danger" />
        <StatusCard label="Processed" value={counts.processed} tone="positive" />
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4 md:flex-row md:items-end">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-zinc-400">Provider</span>
          <select
            value={source}
            onChange={(event) => setSource(event.target.value as WebhookSource | "")}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
          >
            <option value="">All providers</option>
            {SOURCES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-zinc-400">Status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as WebhookStatus | "")}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
          >
            <option value="">All statuses</option>
            {STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            setSource("");
            setStatus("");
          }}
          className="rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
        >
          Clear filters
        </button>
      </div>

      {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-400">
          Loading inbound events...
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          title="No inbound webhook events found."
          description="Adjust filters or trigger a provider webhook/backfill to populate this view."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-900/60 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="px-4 py-3 font-medium">Provider account</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Received</th>
                <th className="px-4 py-3 font-medium">Processed</th>
                <th className="px-4 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {events.map((event) => (
                <tr key={event.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-zinc-100">{labelSource(event.source)}</span>
                      <code className="break-all text-xs text-zinc-500">{event.externalId}</code>
                      {event.error && <span className="text-xs text-red-400">{event.error}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <code className="break-all text-xs text-zinc-400">
                      {event.providerAccountId}
                    </code>
                  </td>
                  <td className="px-4 py-3">
                    <Pill variant={statusVariant(event.status)}>{event.status}</Pill>
                    {!event.signatureVerified && (
                      <p className="mt-2 text-xs text-amber-400">Unsigned or dev-only</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    <Time value={event.receivedAt} />
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {event.processedAt ? <Time value={event.processedAt} /> : "-"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => replay(event.id)}
                      disabled={pending || replayingId === event.id}
                      className="rounded-md border border-blue-500/40 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-500/10 disabled:opacity-30"
                    >
                      {replayingId === event.id ? "Replaying..." : "Replay"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "info" | "danger" | "positive";
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
      <p
        className={`mt-2 text-3xl font-semibold ${
          tone === "danger"
            ? "text-red-400"
            : tone === "positive"
              ? "text-green-400"
              : "text-blue-400"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

async function listInboundWebhooks(input: {
  workspaceId: string;
  subAccountId: string | null;
  source: WebhookSource | "";
  status: WebhookStatus | "";
}) {
  const payload = {
    limit: 50,
    ...(input.source ? { source: input.source } : {}),
    ...(input.status ? { status: input.status } : {}),
  };
  const query = encodeURIComponent(JSON.stringify({ "0": { json: payload } }));
  const res = await fetch(`/api/trpc/webhooks.listInbound?batch=1&input=${query}`, {
    headers: trpcHeaders(input.workspaceId, input.subAccountId),
  });
  return parseTrpcResponse<InboundWebhookEvent[]>(res);
}

async function replayInboundWebhook(input: {
  workspaceId: string;
  subAccountId: string | null;
  inboundEventId: string;
}) {
  const res = await fetch("/api/trpc/webhooks.replayInbound?batch=1", {
    method: "POST",
    headers: trpcHeaders(input.workspaceId, input.subAccountId),
    body: JSON.stringify({ "0": { json: { inboundEventId: input.inboundEventId } } }),
  });
  await parseTrpcResponse(res);
}

async function parseTrpcResponse<T>(res: Response): Promise<T> {
  const json = (await res.json()) as TrpcBatchResponse<T>;
  const message = json[0]?.error?.json?.message ?? json[0]?.error?.message;
  if (!res.ok || message) throw new Error(message ?? `${res.status}: request failed`);
  return json[0]?.result?.data?.json as T;
}

function trpcHeaders(workspaceId: string, subAccountId: string | null) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-workspace-id": workspaceId,
  };
  if (subAccountId) headers["x-sub-account-id"] = subAccountId;
  return headers;
}

function statusVariant(status: WebhookStatus): "info" | "positive" | "danger" {
  if (status === "pending") return "info";
  if (status === "failed") return "danger";
  return "positive";
}

function labelSource(source: string) {
  return SOURCES.find((option) => option.value === source)?.label ?? source;
}
