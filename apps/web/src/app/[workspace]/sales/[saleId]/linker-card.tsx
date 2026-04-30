"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Suggestion = {
  callId: string;
  score: number;
  signals: string[];
  contactName: string | null;
  contactEmail: string | null;
  appointmentAt: string | null;
};

type LinkedCall = {
  id: string;
  contactName: string | null;
  contactEmail: string | null;
  appointmentAt: Date | null;
};

export function LinkerCard({
  slug,
  saleId,
  linkedCall,
  suggestions,
}: {
  slug: string;
  saleId: string;
  linkedCall: LinkedCall | null;
  suggestions: Suggestion[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function getWsId(): Promise<string | null> {
    const res = await fetch(
      "/api/trpc/me?batch=1&input=" + encodeURIComponent(JSON.stringify({ "0": {} })),
    );
    return (await res.json())?.[0]?.result?.data?.json?.workspaceId ?? null;
  }

  function link(callId: string) {
    setError(null);
    startTransition(async () => {
      const wsId = await getWsId();
      if (!wsId) return setError("No workspace");
      const res = await fetch("/api/trpc/sales.linkToCall?batch=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": wsId },
        body: JSON.stringify({ "0": { json: { saleId, callId } } }),
      });
      if (!res.ok) return setError(`Failed (${res.status})`);
      router.refresh();
    });
  }

  function unlink() {
    setError(null);
    startTransition(async () => {
      const wsId = await getWsId();
      if (!wsId) return setError("No workspace");
      const res = await fetch("/api/trpc/sales.unlinkFromCall?batch=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": wsId },
        body: JSON.stringify({ "0": { json: { saleId } } }),
      });
      if (!res.ok) return setError(`Failed (${res.status})`);
      router.refresh();
    });
  }

  if (linkedCall) {
    return (
      <section className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-emerald-400">
              Linked to call
            </p>
            <p className="mt-1 text-sm text-zinc-100">
              <a
                href={`/${slug}/calls/${linkedCall.id}`}
                className="hover:text-blue-400"
              >
                {linkedCall.contactName || linkedCall.contactEmail || "Call"}
              </a>
              {linkedCall.appointmentAt && (
                <span className="ml-2 text-xs text-zinc-500">
                  {new Date(linkedCall.appointmentAt).toLocaleString()}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={unlink}
            disabled={pending}
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-30"
          >
            Unlink
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-xs uppercase tracking-wider text-amber-400">Unlinked sale</p>
      <p className="mt-1 text-sm text-zinc-300">
        {suggestions.length === 0
          ? "No matching call found in the past 14 days."
          : "Suggested matches, ranked by score:"}
      </p>
      {suggestions.length > 0 && (
        <ul className="mt-3 divide-y divide-zinc-800 rounded-md border border-zinc-800">
          {suggestions.map((s) => (
            <li key={s.callId} className="flex items-center gap-3 p-3 text-sm">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs uppercase tracking-wider text-blue-400">
                  {(s.score * 100).toFixed(0)}%
                </span>
                <span className="text-xs text-zinc-500">
                  {s.signals.join(" · ")}
                </span>
              </div>
              <div className="flex-1">
                <a
                  href={`/${slug}/calls/${s.callId}`}
                  className="text-zinc-100 hover:text-blue-400"
                >
                  {s.contactName || s.contactEmail || "Call"}
                </a>
                {s.appointmentAt && (
                  <span className="ml-2 text-xs text-zinc-500">
                    {new Date(s.appointmentAt).toLocaleString()}
                  </span>
                )}
              </div>
              <button
                onClick={() => link(s.callId)}
                disabled={pending}
                className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-30"
              >
                Link
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </section>
  );
}
