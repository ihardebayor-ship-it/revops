import { withTenant } from "@revops/db/client";
import { goals as goalsDomain, team as teamDomain } from "@revops/domain";
import { PageHeader } from "@revops/ui";
import { resolveWorkspaceBySlug } from "~/lib/workspace";
import { GoalsGridEditor } from "./goals-grid-editor";

export default async function GoalsSettingsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);

  if (!ctx.membership.subAccountId) {
    return (
      <div className="space-y-2">
        <PageHeader title="Goals" description="No sub-account context." />
      </div>
    );
  }

  const [grid, team] = await withTenant(ctx.authCtx, async (db) =>
    Promise.all([
      goalsDomain.getTeamGoalsGrid(db, {
        workspaceId: ctx.workspace.id,
        subAccountId: ctx.membership.subAccountId!,
        periodKind: "monthly",
      }),
      teamDomain.listTeam(db, { workspaceId: ctx.workspace.id }),
    ]),
  );

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold tracking-tight">Goals</h2>
      <p className="text-sm text-zinc-400">
        Per-period quotas. Each cell shows the rep's quota and their actual
        attainment for that period — color-graded by status. Click any cell
        to edit, or "+ Quota" on a blank cell to create. Editing live shows
        each rep's last 3 months of actuals so you can calibrate without
        guessing.
      </p>
      <GoalsGridEditor
        slug={slug}
        periods={grid.periods.map((p) => ({
          from: p.from.toISOString().slice(0, 10),
          to: p.to.toISOString().slice(0, 10),
          label: p.label,
        }))}
        rows={grid.rows}
        team={team.members.map((m) => ({
          userId: m.userId,
          name: m.name,
          email: m.email,
        }))}
      />
    </div>
  );
}
