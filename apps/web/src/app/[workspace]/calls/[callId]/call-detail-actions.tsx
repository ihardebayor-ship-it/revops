"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Disposition = {
  id: string;
  slug: string;
  label: string;
  category: string;
};

export function CallDetailActions({
  slug,
  callId,
  dispositions,
  currentDispositionId,
  showedAt,
  completedAt,
}: {
  slug: string;
  callId: string;
  dispositions: Disposition[];
  currentDispositionId: string | null;
  showedAt: string | null;
  completedAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedDisp, setSelectedDisp] = useState(currentDispositionId ?? "");

  async function getWorkspaceId(): Promise<string | null> {
    const res = await fetch(
      "/api/trpc/me?batch=1&input=" + encodeURIComponent(JSON.stringify({ "0": {} })),
    );
    return (await res.json())?.[0]?.result?.data?.json?.workspaceId ?? null;
  }

  function callTrpc(path: string, body: Record<string, unknown>) {
    return startTransition(async () => {
      const wsId = await getWorkspaceId();
      if (!wsId) return setError("No workspace");
      const res = await fetch(`/api/trpc/${path}?batch=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": wsId },
        body: JSON.stringify({ "0": { json: body } }),
      });
      if (!res.ok) {
        return setError(`Failed (${res.status})`);
      }
      setError(null);
      router.refresh();
    });
  }

  void slug;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <h2 className="text-sm font-medium text-zinc-300">Outcome</h2>

      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled={pending || !!showedAt}
          onClick={() =>
            callTrpc("calls.setOutcome", {
              callId,
              showedAt: new Date().toISOString(),
            })
          }
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
        >
          {showedAt ? "✓ Showed" : "Mark showed"}
        </button>
        <button
          disabled={pending || !!completedAt}
          onClick={() =>
            callTrpc("calls.setOutcome", {
              callId,
              completedAt: new Date().toISOString(),
            })
          }
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
        >
          {completedAt ? "✓ Completed" : "Mark completed"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-zinc-400">Disposition:</span>
        <select
          value={selectedDisp}
          onChange={(e) => setSelectedDisp(e.target.value)}
          className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        >
          <option value="">— Select —</option>
          {dispositions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label} ({d.category})
            </option>
          ))}
        </select>
        <button
          disabled={pending || !selectedDisp || selectedDisp === currentDispositionId}
          onClick={() =>
            callTrpc("calls.setDisposition", { callId, dispositionId: selectedDisp })
          }
          className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-30"
        >
          Set
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
