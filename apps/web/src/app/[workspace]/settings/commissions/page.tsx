import { withTenant } from "@revops/db/client";
import { commissionRules as rulesDomain, roles as rolesDomain } from "@revops/domain";
import { resolveWorkspaceBySlug } from "~/lib/workspace";
import { CommissionRulesEditor } from "./rules-editor";

export default async function CommissionRulesSettingsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);

  const [rules, roles] = await withTenant(ctx.authCtx, async (db) =>
    Promise.all([
      rulesDomain.listCommissionRules(db, ctx.workspace.id),
      rolesDomain.listRoles(db, ctx.workspace.id),
    ]),
  );

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold tracking-tight">Commission rules</h2>
      <p className="text-sm text-zinc-400">
        Each rule defines a slice of a sale that goes to one role. Editing a
        rule snapshots a new version; commission entries already produced
        continue to reference the version that produced them, so changes
        never rewrite history. The engine matches the active rule whose
        product/source/effective-date filters fit each sale.
      </p>
      <CommissionRulesEditor
        slug={slug}
        initialRules={rules.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          effectiveFrom: r.effectiveFrom?.toISOString() ?? null,
          effectiveTo: r.effectiveTo?.toISOString() ?? null,
        }))}
        roles={roles.map((r) => ({ id: r.id, label: r.label }))}
      />
    </div>
  );
}
