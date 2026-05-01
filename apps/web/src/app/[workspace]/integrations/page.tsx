import { and, eq, isNull } from "drizzle-orm";
import { withTenant, schema } from "@revops/db/client";
import { EmptyState, PageHeader, Pill, Time } from "@revops/ui";
import { resolveWorkspaceBySlug } from "~/lib/workspace";

const PROVIDERS = [
  {
    id: "gohighlevel",
    name: "GoHighLevel",
    description: "Pulls in appointments + contacts via OAuth.",
    connectHref: (slug: string) => `/api/integrations/ghl/install?workspace=${slug}`,
    connectKind: "oauth" as const,
  },
  {
    id: "aircall",
    name: "Aircall",
    description: "Auto-logs calls with duration + recording.",
    connectHref: (slug: string) => `/${slug}/integrations/connect/aircall`,
    connectKind: "form" as const,
  },
  {
    id: "fathom",
    name: "Fathom",
    description: "Transcript-driven RAG memory for the agent.",
    connectHref: (slug: string) => `/${slug}/integrations/connect/fathom`,
    connectKind: "form" as const,
  },
] as const;

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);

  const connections = await withTenant(ctx.authCtx, async (db) =>
    db
      .select({
        id: schema.dataSourceConnections.id,
        toolType: schema.dataSourceConnections.toolType,
        label: schema.dataSourceConnections.label,
        externalAccountId: schema.dataSourceConnections.externalAccountId,
        healthStatus: schema.dataSourceConnections.healthStatus,
        lastHealthCheckAt: schema.dataSourceConnections.lastHealthCheckAt,
        createdAt: schema.dataSourceConnections.createdAt,
      })
      .from(schema.dataSourceConnections)
      .where(
        and(
          eq(schema.dataSourceConnections.workspaceId, ctx.workspace.id),
          isNull(schema.dataSourceConnections.deletedAt),
        ),
      ),
  );

  const byProvider = new Map(connections.map((c) => [c.toolType, c]));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Integrations"
        description="Connect your data sources. Webhooks pour into the timeline; OAuth + API keys are encrypted at rest."
      />

      <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
        {PROVIDERS.map((p) => {
          const conn = byProvider.get(p.id);
          const variant: "positive" | "warning" | "danger" | "neutral" =
            conn?.healthStatus === "healthy"
              ? "positive"
              : conn?.healthStatus === "degraded"
                ? "warning"
                : conn?.healthStatus === "failing"
                  ? "danger"
                  : "neutral";
          return (
            <li key={p.id} className="flex items-center gap-4 p-4">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-zinc-100">{p.name}</h3>
                  {conn ? (
                    <Pill variant={variant}>{conn.healthStatus}</Pill>
                  ) : (
                    <Pill variant="neutral">not connected</Pill>
                  )}
                </div>
                <p className="mt-1 text-xs text-zinc-400">{p.description}</p>
                {conn && (
                  <p className="mt-1 text-xs text-zinc-500">
                    Connected{" "}
                    <Time value={conn.createdAt} />
                    {conn.externalAccountId && ` · external id ${conn.externalAccountId}`}
                  </p>
                )}
              </div>
              {!conn && (
                <a
                  href={p.connectHref(slug)}
                  className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600"
                >
                  Connect
                </a>
              )}
            </li>
          );
        })}
      </ul>

      {connections.length === 0 && (
        <EmptyState
          title="No integrations connected yet."
          description="Connect any provider above. Inbound webhooks start populating calls, recordings, and customer context immediately."
        />
      )}
    </div>
  );
}
