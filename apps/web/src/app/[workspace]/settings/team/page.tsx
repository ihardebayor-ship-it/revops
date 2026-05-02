import { withTenant } from "@revops/db/client";
import { roles as rolesDomain, team as teamDomain } from "@revops/domain";
import { resolveWorkspaceBySlug } from "~/lib/workspace";
import { TeamEditor } from "./team-editor";

export default async function TeamSettingsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);
  const isAdmin =
    ctx.membership.accessRole === "workspace_admin" ||
    ctx.membership.accessRole === "sub_account_admin" ||
    ctx.authCtx.isSuperadmin;

  const [team, roles] = await withTenant(ctx.authCtx, async (db) =>
    Promise.all([
      teamDomain.listTeam(db, { workspaceId: ctx.workspace.id }),
      rolesDomain.listRoles(db, ctx.workspace.id),
    ]),
  );

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold tracking-tight">Team</h2>
      <p className="text-sm text-zinc-400">
        Workspace members + pending invitations. New invites are claimed when the
        invited user signs up with the same email — no separate invitation email is
        sent in Phase 1; share the URL or just tell them to sign up.
      </p>
      <TeamEditor
        slug={slug}
        currentUserId={ctx.authCtx.userId}
        canEdit={isAdmin}
        members={team.members.map((m) => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
          acceptedAt: m.acceptedAt?.toISOString() ?? null,
        }))}
        invitations={team.invitations.map((i) => ({
          ...i,
          invitedAt: i.invitedAt.toISOString(),
          expiresAt: i.expiresAt.toISOString(),
        }))}
        roles={roles.map((r) => ({ id: r.id, label: r.label }))}
      />
    </div>
  );
}
