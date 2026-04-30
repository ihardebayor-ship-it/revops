import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { getAuth } from "@revops/auth/server";
import { bypassRls, schema } from "@revops/db/client";

// Layout-level guard: only platform_users with is_active=true reach
// /superadmin/* routes. Tenants get redirected home. The check uses
// bypassRls because membership is RLS'd to the workspace context.
export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }
  const isPlatformUser = await bypassRls(async (db) => {
    const rows = await db
      .select({ id: schema.platformUsers.id })
      .from(schema.platformUsers)
      .where(
        and(
          eq(schema.platformUsers.userId, session.user.id),
          eq(schema.platformUsers.isActive, true),
        ),
      )
      .limit(1);
    return rows.length > 0;
  });
  if (!isPlatformUser) {
    redirect("/");
  }

  return (
    <div className="mx-auto max-w-6xl p-8">
      <header className="mb-8 flex items-center justify-between border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-3">
          <span className="rounded-md bg-purple-600/20 px-2 py-1 text-xs font-medium uppercase tracking-wider text-purple-400">
            Superadmin
          </span>
          <h1 className="text-lg font-semibold tracking-tight">Platform admin</h1>
        </div>
        <nav className="flex items-center gap-4 text-sm text-zinc-400">
          <a href="/superadmin/settings" className="hover:text-zinc-100">
            Settings
          </a>
          <a href="/superadmin/agent/evals" className="hover:text-zinc-100">
            Agent evals
          </a>
        </nav>
      </header>
      {children}
    </div>
  );
}
