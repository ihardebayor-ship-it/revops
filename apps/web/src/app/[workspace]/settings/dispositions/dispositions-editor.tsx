"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Disposition = {
  id: string;
  slug: string;
  label: string;
  category: string;
  sortOrder: number;
  isActive: number;
};

const CATEGORY_BADGE: Record<string, string> = {
  positive: "bg-green-500/10 text-green-400",
  won: "bg-emerald-500/10 text-emerald-400",
  objection: "bg-amber-500/10 text-amber-400",
  disqualification: "bg-red-500/10 text-red-400",
  no_show: "bg-zinc-500/10 text-zinc-400",
  rescheduled: "bg-blue-500/10 text-blue-400",
  other: "bg-zinc-500/10 text-zinc-400",
};

export function DispositionsEditor({ initialDispositions }: { initialDispositions: Disposition[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<Disposition>>>({});

  function save(dispId: string) {
    const patch = edits[dispId];
    if (!patch) return;
    setError(null);
    startTransition(async () => {
      const wsId = await fetchWorkspaceId();
      if (!wsId) {
        setError("No workspace");
        return;
      }
      const body: Record<string, unknown> = { dispositionId: dispId };
      if (patch.label !== undefined) body.label = patch.label;
      if (patch.sortOrder !== undefined) body.sortOrder = Number(patch.sortOrder);
      if (patch.isActive !== undefined) body.isActive = Number(patch.isActive);
      const res = await fetch("/api/trpc/dispositions.update?batch=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": wsId },
        body: JSON.stringify({ "0": { json: body } }),
      });
      if (!res.ok) {
        setError(`Failed (${res.status})`);
        return;
      }
      setEdits((prev) => {
        const next = { ...prev };
        delete next[dispId];
        return next;
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
      <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
        {initialDispositions.map((d) => {
          const edit = edits[d.id] ?? {};
          const dirty = Object.keys(edit).length > 0;
          return (
            <li key={d.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
              <span
                className={`rounded px-2 py-1 text-xs font-medium uppercase tracking-wider ${CATEGORY_BADGE[d.category] ?? CATEGORY_BADGE.other}`}
              >
                {d.category}
              </span>
              <label className="flex flex-1 flex-col gap-1">
                <input
                  defaultValue={d.label}
                  onChange={(e) =>
                    setEdits((prev) => ({
                      ...prev,
                      [d.id]: { ...prev[d.id], label: e.target.value },
                    }))
                  }
                  className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                <span className="text-xs text-zinc-500">slug: {d.slug}</span>
              </label>
              <button
                disabled={!dirty || pending}
                onClick={() => save(d.id)}
                className="rounded-md bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-30"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

async function fetchWorkspaceId(): Promise<string | null> {
  const res = await fetch(
    "/api/trpc/me?batch=1&input=" + encodeURIComponent(JSON.stringify({ "0": {} })),
  );
  const json = await res.json();
  return json?.[0]?.result?.data?.json?.workspaceId ?? null;
}
