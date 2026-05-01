"use client";

import { useEffect, useState, useTransition } from "react";
import { subscribe } from "@revops/realtime/client";
import { channelNames, events as evNames } from "@revops/realtime/channels";

type SendResult = {
  ok: boolean;
  threadId?: string;
  turnId?: string;
  dispatched?: boolean;
  error?: string;
};

type LiveEvent =
  | {
      kind: "tool";
      ts: number;
      turnId: string;
      toolUseId: string;
      name: string;
      input: unknown;
    }
  | {
      kind: "complete";
      ts: number;
      turnId: string;
      stopReason: string;
      costUsd: number;
      text: string;
    };

export function AgentChatShell({ workspaceId }: { workspaceId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [last, setLast] = useState<SendResult | null>(null);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);

  // When a thread becomes active, subscribe to its channel and append every
  // tool-proposed + turn-complete event into the live event log. The Pusher
  // channel auth route (apps/web/src/app/api/pusher/auth/route.ts) verifies
  // the user owns the thread before issuing a signed token.
  useEffect(() => {
    if (!last?.threadId) return;
    const channel = channelNames.agentThread(last.threadId);
    const offTool = subscribe(channel, evNames.agentToolProposed, (raw) => {
      const data = raw as {
        turnId: string;
        toolUseId: string;
        name: string;
        input: unknown;
      };
      setLiveEvents((prev) => [
        ...prev,
        {
          kind: "tool",
          ts: Date.now(),
          turnId: data.turnId,
          toolUseId: data.toolUseId,
          name: data.name,
          input: data.input,
        },
      ]);
    });
    const offDone = subscribe(channel, evNames.agentTurnComplete, (raw) => {
      const data = raw as {
        turnId: string;
        stopReason: string;
        costUsd: number;
        text: string;
      };
      setLiveEvents((prev) => [
        ...prev,
        {
          kind: "complete",
          ts: Date.now(),
          turnId: data.turnId,
          stopReason: data.stopReason,
          costUsd: data.costUsd,
          text: data.text,
        },
      ]);
    });
    return () => {
      offTool.unsubscribe();
      offDone.unsubscribe();
    };
  }, [last?.threadId]);

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
          {last?.threadId && (
            <>
              {" · "}thread <code className="text-zinc-300">{last.threadId.slice(0, 8)}</code>
            </>
          )}
        </p>
        <button
          disabled={pending || message.trim().length === 0}
          onClick={() => {
            startTransition(async () => {
              const res = await fetch("/api/agent/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  message: message.trim(),
                  threadId: last?.threadId,
                }),
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
      {last && !last.ok && (
        <p className="text-xs text-red-400">Error: {last.error}</p>
      )}
      {last?.ok && !last.dispatched && (
        <p className="text-xs text-amber-400">
          Queued. The user message is persisted but the agent worker won't pick it up
          without an Inngest dev key.
        </p>
      )}

      {liveEvents.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wider text-zinc-400">Live</p>
          <ul className="flex flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-900 p-3 text-xs">
            {liveEvents.map((e, i) => (
              <li key={i} className="flex items-start gap-2 font-mono text-zinc-300">
                {e.kind === "tool" ? (
                  <>
                    <span className="text-blue-400">tool →</span>
                    <span className="text-zinc-100">{e.name}</span>
                    <span className="ml-auto text-zinc-500">
                      {new Date(e.ts).toLocaleTimeString()}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-emerald-400">done</span>
                    <span className="flex-1 text-zinc-100">
                      {e.text || `(${e.stopReason})`}
                    </span>
                    <span className="text-zinc-500">
                      ${e.costUsd.toFixed(4)}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
