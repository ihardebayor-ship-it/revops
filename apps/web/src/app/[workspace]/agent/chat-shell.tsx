"use client";

import { useState, useTransition } from "react";

type SendResult = {
  ok: boolean;
  threadId?: string;
  turnId?: string;
  dispatched?: boolean;
  error?: string;
};

export function AgentChatShell({ workspaceId }: { workspaceId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [last, setLast] = useState<SendResult | null>(null);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-xs uppercase tracking-wider text-zinc-400">Send a message</p>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="e.g. Link the unlinked sales from this morning"
        rows={3}
        className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          Workspace: <code className="text-zinc-300">{workspaceId.slice(0, 8)}</code>
          {" · "}
          <span className="text-zinc-400">Streaming via Pusher → Phase 2 ✦ tool events ✓</span>
        </p>
        <button
          disabled={pending || message.trim().length === 0}
          onClick={() => {
            startTransition(async () => {
              const res = await fetch("/api/agent/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: message.trim() }),
              });
              const json = (await res.json()) as SendResult;
              setLast(json);
              if (json.ok) setMessage("");
            });
          }}
          className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-30"
        >
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
      {last && (
        <p className="text-xs text-zinc-500">
          {last.ok
            ? `Queued. thread=${last.threadId?.slice(0, 8)} turn=${last.turnId?.slice(0, 8)}${last.dispatched ? "" : " (no Inngest dev key — message persisted only)"}`
            : `Error: ${last.error}`}
        </p>
      )}
    </section>
  );
}
