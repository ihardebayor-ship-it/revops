"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function CreateTaskButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(form: FormData) {
    setError(null);
    const title = String(form.get("title") || "").trim();
    if (!title) {
      setError("Title is required");
      return;
    }
    startTransition(async () => {
      const wsSlug = window.location.pathname.split("/")[1];
      // Use header-based workspace resolution. tRPC route reads
      // x-workspace-id from headers; we read the workspace UUID via the
      // /api/me endpoint (or in Phase 1 M1.10, via a context provider).
      // For Phase 0+M1, we call /api/trpc/me first to grab workspace_id —
      // good enough for the demo flow until tRPC client + context land.
      const meRes = await fetch("/api/trpc/me?batch=1&input=" + encodeURIComponent(JSON.stringify({ "0": {} })));
      const meJson = await meRes.json();
      const workspaceId = meJson?.[0]?.result?.data?.json?.workspaceId;
      if (!workspaceId) {
        setError("No workspace context");
        return;
      }
      const body = JSON.stringify({
        "0": {
          json: {
            kind: "custom",
            title,
            description: String(form.get("description") || "") || undefined,
          },
        },
      });
      const res = await fetch("/api/trpc/tasks.create?batch=1", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body,
      });
      if (!res.ok) {
        const text = await res.text();
        setError(`Failed (${res.status}): ${text.slice(0, 200)}`);
        return;
      }
      setOpen(false);
      // Re-render the server component to show the new task.
      void wsSlug;
      router.refresh();
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600"
      >
        New task
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            action={onSubmit}
            className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-6"
          >
            <header>
              <h2 className="text-lg font-semibold tracking-tight">New task</h2>
            </header>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-zinc-400">Title</span>
              <input
                name="title"
                required
                autoFocus
                className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-zinc-400">Description</span>
              <textarea
                name="description"
                rows={3}
                className="resize-none rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>
            {error && (
              <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {pending ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
