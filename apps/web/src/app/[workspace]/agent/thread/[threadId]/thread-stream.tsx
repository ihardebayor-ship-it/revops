"use client";

// Live stream overlay for the thread detail page. Subscribes to
// private-agent-thread-{threadId} and renders incoming events
// (tool.proposed, turn.complete) below the static message log so the
// user sees the agent working in real time. On turn.complete we just
// router.refresh() — that re-fetches the messages + audit rows from
// the server, so the inline stream view fades and the persisted
// version takes over.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { subscribe } from "@revops/realtime/client";
import { channelNames, events as evNames } from "@revops/realtime/channels";
import { Pill, Time } from "@revops/ui";

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

export function ThreadStream({ threadId }: { threadId: string }) {
  const router = useRouter();
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);

  useEffect(() => {
    const channel = channelNames.agentThread(threadId);
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
      // Server-rendered persisted view will catch up; refresh and the
      // live stream stays as a brief animation underneath.
      setTimeout(() => {
        router.refresh();
        setTimeout(() => setLiveEvents([]), 1500);
      }, 500);
    });
    return () => {
      offTool.unsubscribe();
      offDone.unsubscribe();
    };
  }, [threadId, router]);

  if (liveEvents.length === 0) return null;

  return (
    <section className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4">
      <p className="text-xs uppercase tracking-wider text-blue-400">Live</p>
      <ul className="mt-2 flex flex-col gap-1.5 text-xs">
        {liveEvents.map((e, i) => (
          <li key={i} className="flex items-start gap-2 font-mono text-zinc-300">
            {e.kind === "tool" ? (
              <>
                <Pill variant="info">tool</Pill>
                <span className="text-zinc-100">{e.name}</span>
                <span className="ml-auto text-zinc-500">
                  <Time value={new Date(e.ts)} />
                </span>
              </>
            ) : (
              <>
                <Pill variant="positive">done</Pill>
                <span className="flex-1 text-zinc-100">
                  {e.text || `(${e.stopReason})`}
                </span>
                <span className="text-zinc-500">${e.costUsd.toFixed(4)}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
