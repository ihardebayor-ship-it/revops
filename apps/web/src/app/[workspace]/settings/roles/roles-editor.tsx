"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Role = {
  id: string;
  slug: string;
  label: string;
  defaultCommissionShare: string;
  defaultSlaSeconds: number | null;
};

export function RolesEditor({ initialRoles }: { initialRoles: Role[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<Role>>>({});

  function setField(roleId: string, key: keyof Role, value: string) {
    setEdits((prev) => ({ ...prev, [roleId]: { ...prev[roleId], [key]: value } }));
  }

  function save(roleId: string) {
    const patch = edits[roleId];
    if (!patch || Object.keys(patch).length === 0) return;
    setError(null);
    startTransition(async () => {
      const wsId = await fetchWorkspaceId();
      if (!wsId) {
        setError("No workspace");
        return;
      }
      const body: Record<string, unknown> = { roleId };
      if (patch.label !== undefined) body.label = patch.label;
      if (patch.defaultCommissionShare !== undefined) {
        body.defaultCommissionShare = patch.defaultCommissionShare;
      }
      const res = await fetch("/api/trpc/roles.update?batch=1", {
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
        delete next[roleId];
        return next;
      });
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
      <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
        {initialRoles.map((role) => {
          const edit = edits[role.id] ?? {};
          const dirty = Object.keys(edit).length > 0;
          return (
            <li key={role.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-end">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-xs uppercase tracking-wider text-zinc-400">Label</span>
                <input
                  defaultValue={role.label}
                  onChange={(e) => setField(role.id, "label", e.target.value)}
                  className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                <span className="text-xs text-zinc-500">slug: {role.slug}</span>
              </label>
              <label className="flex w-40 flex-col gap-1">
                <span className="text-xs uppercase tracking-wider text-zinc-400">
                  Default share
                </span>
                <input
                  defaultValue={role.defaultCommissionShare}
                  onChange={(e) =>
                    setField(role.id, "defaultCommissionShare", e.target.value)
                  }
                  className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                <span className="text-xs text-zinc-500">0–1 (e.g. 0.20)</span>
              </label>
              <button
                disabled={!dirty || pending}
                onClick={() => save(role.id)}
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
