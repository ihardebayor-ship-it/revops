import { withTenant } from "@revops/db/client";
import { dispositions as dispositionsDomain } from "@revops/domain";
import { resolveWorkspaceBySlug } from "~/lib/workspace";
import { DispositionsEditor } from "./dispositions-editor";

export default async function DispositionsSettingsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);

  const dispositions = await withTenant(ctx.authCtx, (db) =>
    dispositionsDomain.listDispositions(db, ctx.workspace.id),
  );

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold tracking-tight">Call &amp; sale dispositions</h2>
      <p className="text-sm text-zinc-400">
        Outcome categories you assign to calls and sales. Use these to track
        why deals don't close: price, timing, decision-maker, competitor,
        etc.
      </p>
      <DispositionsEditor initialDispositions={dispositions} />
    </div>
  );
}
