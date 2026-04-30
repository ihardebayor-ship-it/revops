import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq, and, isNull } from "drizzle-orm";
import { getAuth } from "@revops/auth/server";
import { bypassRls, schema } from "@revops/db/client";
import { TOPOLOGY_PRESETS } from "@revops/domain/onboarding";
import { getBrand } from "~/lib/brand";

// Phase 0 placeholder. Workspace bootstrap already runs on sign-up with the
// `solo` preset. Phase 1 M1 turns this into a 3-question wizard that
// (a) re-bootstraps with a different preset if the workspace is empty,
// (b) onboards the user into per-role dashboards.
export default async function OnboardingPage() {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  // Show the user's auto-created workspace + the preset it was bootstrapped with.
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

  const brand = await getBrand(workspace?.id);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Welcome to {brand.name}</h1>
        <p className="mt-2 text-zinc-400">
          Your workspace is ready. {workspace ? `Currently set up with the "${workspace.topologyPreset}" preset.` : ""}
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Topology presets</h2>
        <p className="text-sm text-zinc-400">
          Phase 1 will turn this into a 3-question wizard that picks the right preset for
          your team. For now, here's what each preset configures:
        </p>
        <div className="grid gap-3">
          {Object.values(TOPOLOGY_PRESETS).map((preset) => (
            <div
              key={preset.slug}
              className={`rounded-md border p-4 ${preset.slug === workspace?.topologyPreset ? "border-blue-500 bg-blue-500/5" : "border-zinc-800"}`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">{preset.label}</span>
                {preset.slug === workspace?.topologyPreset && (
                  <span className="text-xs uppercase tracking-wider text-blue-400">Active</span>
                )}
              </div>
              <p className="text-sm text-zinc-400">{preset.description}</p>
              {preset.roles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
                  {preset.roles.map((r) => (
                    <span key={r.slug} className="rounded bg-zinc-900 px-2 py-1">
                      {r.label} · {Math.round(parseFloat(r.defaultCommissionShare) * 100)}%
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <a
          href={workspace ? `/${workspace.slug}/dashboard` : "/"}
          className="inline-block rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
        >
          Continue
        </a>
      </section>
    </main>
  );
}
