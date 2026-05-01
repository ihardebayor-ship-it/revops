import { PageHeader } from "@revops/ui";
import { resolveWorkspaceBySlug } from "~/lib/workspace";

export default async function FathomConnectPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  await resolveWorkspaceBySlug(slug);

  const webhookUrl = `/api/webhooks/fathom`;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader
        title="Connect Fathom"
        description="Fathom is webhook-only. Point a webhook at the URL below; transcripts ingest into the agent's RAG memory."
      />

      <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-6">
        <Detail label="Webhook URL">
          <code className="rounded bg-zinc-900 px-2 py-1 text-xs text-blue-300">
            https://&lt;your-host&gt;{webhookUrl}
          </code>
        </Detail>
        <Detail label="Header (optional)">
          <code className="rounded bg-zinc-900 px-2 py-1 text-xs text-blue-300">
            x-fathom-signature: sha256=…
          </code>
          <span className="ml-2 text-xs text-zinc-500">
            Required in production. Set <code>FATHOM_WEBHOOK_SECRET</code> on the server.
          </span>
        </Detail>
        <Detail label="Event">
          <code className="rounded bg-zinc-900 px-2 py-1 text-xs text-blue-300">
            recording.completed
          </code>
        </Detail>
        <p className="mt-2 text-xs text-zinc-400">
          Once configured, transcripts ingest automatically: chunked at ~5,000-char
          paragraphs, embedded with text-embedding-3-small, written as agent_facts
          rows scoped to the matched customer. Future agent turns retrieve the
          most-relevant chunks via cosine similarity.
        </p>
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-zinc-400">{label}</span>
      <div className="text-sm text-zinc-100">{children}</div>
    </div>
  );
}
