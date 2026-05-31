import { PageHeader } from "@revops/ui";
import { resolveWorkspaceBySlug } from "~/lib/workspace";
import { WebhookEventsPanel } from "./webhook-events-panel";

export default async function WebhookEventsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Inbound Webhooks"
        description="Inspect tenant-scoped provider events, classify failures, and replay stuck ingestions. Payloads stay hidden from this ops view."
        actions={
          <a
            href={`/${slug}/integrations`}
            className="rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            Back to integrations
          </a>
        }
      />
      <WebhookEventsPanel workspaceId={ctx.workspace.id} subAccountId={ctx.authCtx.subAccountId} />
    </div>
  );
}
