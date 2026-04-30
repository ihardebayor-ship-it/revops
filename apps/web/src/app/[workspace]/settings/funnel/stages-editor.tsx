"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Stage = {
  id: string;
  slug: string;
  label: string;
  kind: string;
  ordinal: number;
};

export function StagesEditor({ initialStages }: { initialStages: Stage[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<Stage>>>({});

  function save(stageId: string) {
    const patch = edits[stageId];
    if (!patch) return;
    setError(null);
    startTransition(async () => {
      const wsId = await fetchWorkspaceId();
      if (!wsId) {
        setError("No workspace");
        return;
      }
      const body: Record<string, unknown> = { stageId };
      if (patch.label !== undefined) body.label = patch.label;
      if (patch.ordinal !== undefined) body.ordinal = Number(patch.ordinal);
      const res = await fetch("/api/trpc/funnel.updateStage?batch=1", {
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
        delete next[stageId];
        return next;
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
      <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
        {initialStages.map((stage) => {
          const edit = edits[stage.id] ?? {};
          const dirty = Object.keys(edit).length > 0;
          return (
            <li key={stage.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-end">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-xs uppercase tracking-wider text-zinc-400">Label</span>
                <input
                  defaultValue={stage.label}
                  onChange={(e) =>
                    setEdits((prev) => ({
                      ...prev,
                      [stage.id]: { ...prev[stage.id], label: e.target.value },
                    }))
                  }
                  className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                <span className="text-xs text-zinc-500">
                  {stage.kind} · slug: {stage.slug}
                </span>
              </label>
              <label className="flex w-32 flex-col gap-1">
                <span className="text-xs uppercase tracking-wider text-zinc-400">Ordinal</span>
                <input
                  type="number"
                  defaultValue={stage.ordinal}
                  onChange={(e) =>
                    setEdits((prev) => ({
                      ...prev,
                      [stage.id]: { ...prev[stage.id], ordinal: Number(e.target.value) },
                    }))
                  }
                  className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </label>
              <button
                disabled={!dirty || pending}
                onClick={() => save(stage.id)}
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
