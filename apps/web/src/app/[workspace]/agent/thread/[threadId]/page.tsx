// Agent thread detail.
//
// Closes the demo loop: ask → see thinking → see tools fire → see audit
// trail → see the result. Right now the agent page lets you SEND
// messages but you can't READ past conversations — this is the read
// surface.
//
// Layout: chronological message log (user → assistant turns), each
// turn showing inline tool-pills with the action + audit row + the
// tool result. Footer per turn shows model + token cost. Live updates
// via Pusher subscribe-on-mount (handled by the client component).

import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { withTenant, schema } from "@revops/db/client";
import { PageHeader, Pill, Time } from "@revops/ui";
import { resolveWorkspaceBySlug } from "~/lib/workspace";
import { ThreadStream } from "./thread-stream";

export default async function AgentThreadDetailPage({
  params,
}: {
  params: Promise<{ workspace: string; threadId: string }>;
}) {
  const { workspace: slug, threadId } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);

  const detail = await withTenant(ctx.authCtx, async (db) => {
    const [thread] = await db
      .select({
        id: schema.agentThreads.id,
        title: schema.agentThreads.title,
        userId: schema.agentThreads.userId,
        summary: schema.agentThreads.summary,
        createdAt: schema.agentThreads.createdAt,
        lastMessageAt: schema.agentThreads.lastMessageAt,
        totalCostUsd: schema.agentThreads.totalCostUsd,
        archivedAt: schema.agentThreads.archivedAt,
      })
      .from(schema.agentThreads)
      .where(
        and(
          eq(schema.agentThreads.id, threadId),
          eq(schema.agentThreads.workspaceId, ctx.workspace.id),
        ),
      )
      .limit(1);
    if (!thread) return null;

    // Only the thread owner (or superadmin) sees the conversation.
    if (thread.userId !== ctx.authCtx.userId && !ctx.authCtx.isSuperadmin) return null;

    const messages = await db
      .select({
        id: schema.agentMessages.id,
        turnId: schema.agentMessages.turnId,
        role: schema.agentMessages.role,
        content: schema.agentMessages.content,
        model: schema.agentMessages.model,
        tokenUsage: schema.agentMessages.tokenUsage,
        costUsd: schema.agentMessages.costUsd,
        toolName: schema.agentMessages.toolName,
        toolCallId: schema.agentMessages.toolCallId,
        createdAt: schema.agentMessages.createdAt,
      })
      .from(schema.agentMessages)
      .where(eq(schema.agentMessages.threadId, threadId))
      .orderBy(asc(schema.agentMessages.createdAt));

    const turnIds = Array.from(new Set(messages.map((m) => m.turnId)));
    const auditRows =
      turnIds.length > 0
        ? await db
            .select({
              id: schema.auditLog.id,
              agentTraceId: schema.auditLog.agentTraceId,
              action: schema.auditLog.action,
              resourceType: schema.auditLog.resourceType,
              resourceId: schema.auditLog.resourceId,
              after: schema.auditLog.after,
              metadata: schema.auditLog.metadata,
              createdAt: schema.auditLog.createdAt,
            })
            .from(schema.auditLog)
            .where(
              and(
                eq(schema.auditLog.workspaceId, ctx.workspace.id),
                eq(schema.auditLog.actorKind, "agent_on_behalf_of_user"),
                inArray(schema.auditLog.agentTraceId, turnIds),
              ),
            )
            .orderBy(asc(schema.auditLog.createdAt))
        : [];

    return { thread, messages, auditRows };
  });
  if (!detail) notFound();

  const { thread, messages, auditRows } = detail;

  // Group messages + audit rows by turnId so each turn renders as a
  // self-contained card. Turns are ordered by their first message's createdAt.
  const turnOrder: string[] = [];
  const messagesByTurn = new Map<string, typeof messages>();
  for (const m of messages) {
    if (!messagesByTurn.has(m.turnId)) {
      messagesByTurn.set(m.turnId, []);
      turnOrder.push(m.turnId);
    }
    messagesByTurn.get(m.turnId)!.push(m);
  }
  const auditByTurn = new Map<string, typeof auditRows>();
  for (const a of auditRows) {
    if (!a.agentTraceId) continue;
    if (!auditByTurn.has(a.agentTraceId)) auditByTurn.set(a.agentTraceId, []);
    auditByTurn.get(a.agentTraceId)!.push(a);
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={thread.title || "Agent thread"}
        description={
          thread.summary
            ? thread.summary
            : `Started ${formatRelative(thread.createdAt)} · cost $${Number(thread.totalCostUsd).toFixed(4)}`
        }
        actions={
          <a
            href={`/${slug}/agent`}
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            Back to threads
          </a>
        }
      />

      <ol className="flex flex-col gap-5">
        {turnOrder.map((turnId) => {
          const turnMessages = messagesByTurn.get(turnId)!;
          const turnAudit = auditByTurn.get(turnId) ?? [];
          return (
            <li key={turnId} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
              <TurnHeader messages={turnMessages} />
              <div className="mt-3 flex flex-col gap-3">
                {turnMessages.map((m) => (
                  <MessageBlock key={m.id} message={m} />
                ))}
                {turnAudit.length > 0 && (
                  <ul className="flex flex-col gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
                    {turnAudit.map((a) => (
                      <ToolPill key={a.id} audit={a} />
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <ThreadStream threadId={thread.id} />
    </div>
  );
}

function TurnHeader({
  messages,
}: {
  messages: Array<{
    role: string;
    model: string | null;
    costUsd: string | null;
    tokenUsage: { input?: number; output?: number; cacheCreate?: number; cacheRead?: number } | null;
    createdAt: Date;
  }>;
}) {
  const first = messages[0]!;
  const totalCost = messages.reduce((acc, m) => acc + Number(m.costUsd ?? 0), 0);
  const inputTokens = messages.reduce(
    (acc, m) => acc + (m.tokenUsage?.input ?? 0),
    0,
  );
  const outputTokens = messages.reduce(
    (acc, m) => acc + (m.tokenUsage?.output ?? 0),
    0,
  );
  const model = messages.find((m) => m.model)?.model ?? null;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-3 text-xs text-zinc-500">
      <span>
        Turn at <Time value={first.createdAt} />
      </span>
      <span className="flex items-center gap-3">
        {model && (
          <span className="rounded bg-zinc-900 px-2 py-0.5 font-mono text-zinc-300">
            {model}
          </span>
        )}
        {(inputTokens > 0 || outputTokens > 0) && (
          <span>
            {inputTokens.toLocaleString()} in · {outputTokens.toLocaleString()} out
          </span>
        )}
        {totalCost > 0 && <span>${totalCost.toFixed(4)}</span>}
      </span>
    </div>
  );
}

function MessageBlock({
  message,
}: {
  message: {
    role: string;
    content: Record<string, unknown>;
    toolName: string | null;
  };
}) {
  const text =
    typeof (message.content as { text?: string }).text === "string"
      ? (message.content as { text: string }).text
      : null;

  const variant = roleVariant(message.role);
  return (
    <div
      className={
        variant === "user"
          ? "rounded-lg border border-blue-500/30 bg-blue-500/5 p-3"
          : variant === "assistant"
            ? "rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"
            : "rounded-md border border-zinc-800 bg-zinc-900/30 p-2"
      }
    >
      <div className="mb-1 flex items-center gap-2 text-xs">
        <Pill
          variant={
            variant === "user"
              ? "info"
              : variant === "assistant"
                ? "neutral"
                : "neutral"
          }
        >
          {message.role.replace("_", " ")}
        </Pill>
        {message.toolName && (
          <code className="font-mono text-blue-400">{message.toolName}</code>
        )}
      </div>
      {text ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-100">{text}</p>
      ) : (
        <pre className="overflow-x-auto rounded bg-zinc-950 p-2 text-xs text-zinc-300">
          {JSON.stringify(message.content, null, 2)}
        </pre>
      )}
    </div>
  );
}

function roleVariant(role: string): "user" | "assistant" | "tool" {
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  return "tool";
}

function ToolPill({
  audit,
}: {
  audit: {
    id: string;
    action: string;
    resourceType: string;
    resourceId: string | null;
    after: Record<string, unknown> | null;
    metadata: Record<string, unknown>;
    createdAt: Date;
  };
}) {
  const toolName = audit.action.replace(/^tool:/, "");
  const errored = typeof audit.metadata.error === "string";
  const durationMs =
    typeof audit.metadata.durationMs === "number" ? audit.metadata.durationMs : null;
  return (
    <li className="flex items-start gap-3 text-xs">
      <Pill variant={errored ? "danger" : "positive"}>
        {errored ? "tool err" : "tool ok"}
      </Pill>
      <div className="flex-1">
        <p className="text-sm">
          <code className="font-mono text-blue-400">{toolName}</code>
          <span className="ml-2 text-zinc-500">
            on {audit.resourceType}
            {audit.resourceId && (
              <code className="ml-1 font-mono text-zinc-400">
                {audit.resourceId.slice(0, 8)}
              </code>
            )}
          </span>
        </p>
        {errored ? (
          <p className="mt-1 text-rose-400">
            error: {String(audit.metadata.error)}
          </p>
        ) : audit.after ? (
          <details className="mt-1">
            <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
              result
            </summary>
            <pre className="mt-1 overflow-x-auto rounded bg-zinc-950 p-2 text-zinc-300">
              {JSON.stringify(audit.after, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>
      <span className="text-zinc-500">
        {durationMs !== null ? `${durationMs}ms` : <Time value={audit.createdAt} />}
      </span>
    </li>
  );
}

function formatRelative(date: Date): string {
  const ms = Date.now() - date.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
