import { withTenant } from "@revops/db/client";
import { roles as rolesDomain } from "@revops/domain";
import { resolveWorkspaceBySlug } from "~/lib/workspace";
import { RolesEditor } from "./roles-editor";

export default async function RolesSettingsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);

  const roles = await withTenant(ctx.authCtx, (db) =>
    rolesDomain.listRoles(db, ctx.workspace.id),
  );

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold tracking-tight">Sales roles</h2>
      <p className="text-sm text-zinc-400">
        These are the roles people fill on a sale. Editing a role creates a new
        version; existing commission entries continue to reference the version
        that produced them, so renaming "closer" to "AE" mid-quarter does not
        rewrite history.
      </p>
      <RolesEditor initialRoles={roles} />
    </div>
  );
}
