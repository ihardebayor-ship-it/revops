import { PageHeader } from "@revops/ui";
import { resolveWorkspaceBySlug } from "~/lib/workspace";
import { AircallConnectForm } from "./form";

export default async function AircallConnectPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  await resolveWorkspaceBySlug(slug);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader
        title="Connect Aircall"
        description="Aircall uses API-key auth (Basic). Find these in the Aircall dashboard → Integrations & API."
      />
      <AircallConnectForm workspaceSlug={slug} />
    </div>
  );
}
