import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq, and, isNull } from "drizzle-orm";
import { getAuth } from "@revops/auth/server";
import { bypassRls, schema } from "@revops/db/client";
import { TOPOLOGY_PRESETS } from "@revops/domain/onboarding";
import { getBrand } from "~/lib/brand";
import { OnboardingWizard } from "./wizard";

// Elite onboarding wizard. JTBD: get the user from sign-up to a populated
// workspace they can actually demo / use, in <2 minutes.
//
// Three steps:
//   1. Topology + workspace name (live preview of what each preset
//      configures, edit the workspace name inline)
//   2. First quota (live calibration: industry-default suggestions; if
//      they skip, dashboards still work, just no forecast)
//   3. Sample data option (one-click "see what this looks like with
//      data" → populates a Demo sub-account; or skip to land in their
//      empty real workspace)

export default async function OnboardingPage() {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  const workspace = await bypassRls(async (db) => {
    const rows = await db
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        slug: schema.workspaces.slug,
        topologyPreset: schema.workspaces.topologyPreset,
      })
      .from(schema.workspaces)
      .innerJoin(schema.memberships, eq(schema.memberships.workspaceId, schema.workspaces.id))
      .where(
        and(
          eq(schema.memberships.userId, session.user.id),
          isNull(schema.workspaces.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  });

  if (!workspace) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Workspace not ready</h1>
        <p className="mt-2 text-sm text-zinc-400">
          We didn't find a workspace for your account. Try signing out and back in.
        </p>
      </main>
    );
  }

  const brand = await getBrand(workspace.id);
  const presets = Object.values(TOPOLOGY_PRESETS).map((p) => ({
    slug: p.slug,
    label: p.label,
    description: p.description,
    roles: p.roles.map((r) => ({
      slug: r.slug,
      label: r.label,
      sharePct: parseFloat(r.defaultCommissionShare),
    })),
    stages: p.stages.map((s) => ({ slug: s.slug, label: s.label })),
  }));

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <header>
        <p className="text-xs uppercase tracking-wider text-blue-400">{brand.name}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-100">
          Set up your workspace
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Three quick choices. Skip any and adjust in Settings later — none of these lock
          you into anything.
        </p>
      </header>
      <OnboardingWizard
        workspace={{
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          topologyPreset: workspace.topologyPreset,
        }}
        presets={presets}
      />
    </main>
  );
}
