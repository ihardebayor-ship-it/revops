import { withTenant } from "@revops/db/client";
import { funnel as funnelDomain } from "@revops/domain";
import { resolveWorkspaceBySlug } from "~/lib/workspace";
import { StagesEditor } from "./stages-editor";

export default async function FunnelSettingsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);

  const stages = await withTenant(ctx.authCtx, (db) =>
    funnelDomain.listStages(db, ctx.workspace.id),
  );

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold tracking-tight">Funnel stages</h2>
      <p className="text-sm text-zinc-400">
        Stages your prospects move through. Speed-to-lead, show-up rate, and
        close-rate are all queries over the funnel-events stream tagged with
        these stages.
      </p>
      <StagesEditor initialStages={stages} />
    </div>
  );
}
