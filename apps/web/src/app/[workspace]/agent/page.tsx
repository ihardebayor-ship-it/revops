import { desc, eq } from "drizzle-orm";
import { withTenant, schema } from "@revops/db/client";
import { EmptyState, PageHeader, Time } from "@revops/ui";
import { resolveWorkspaceBySlug } from "~/lib/workspace";
import { AgentChatShell } from "./chat-shell";

export default async function AgentPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);

  const threads = await withTenant(ctx.authCtx, async (db) =>
    db
      .select({
        id: schema.agentThreads.id,
        title: schema.agentThreads.title,
        lastMessageAt: schema.agentThreads.lastMessageAt,
        totalCostUsd: schema.agentThreads.totalCostUsd,
      })
      .from(schema.agentThreads)
      .where(eq(schema.agentThreads.userId, ctx.authCtx.userId))
      .orderBy(desc(schema.agentThreads.lastMessageAt))
      .limit(20),
  );

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Agent"
        description="Ask the agent to investigate, link, complete tasks, or surface what's drifting in your funnel. Every action is audited."
      />
      <AgentChatShell workspaceId={ctx.workspace.id} />
      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">Recent threads</h2>
        {threads.length === 0 ? (
          <EmptyState
            title="No threads yet."
            description="Ask the agent something above to start a conversation."
          />
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
            {threads.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="flex-1 text-zinc-100">{t.title}</span>
                <span className="text-xs text-zinc-500">
                  ${Number(t.totalCostUsd).toFixed(4)}
                </span>
                <span className="text-xs text-zinc-500">
                  <Time value={t.lastMessageAt} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
