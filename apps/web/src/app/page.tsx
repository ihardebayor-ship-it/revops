import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { Brand, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@revops/ui";
import { getAuth } from "@revops/auth/server";
import { bypassRls, schema } from "@revops/db/client";
import { getBrand } from "~/lib/brand";

export default async function HomePage() {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });

  // Authed users get sent to their last-active workspace's inbox.
  if (session?.user) {
    const slug = await bypassRls(async (db) => {
      const rows = await db
        .select({ slug: schema.workspaces.slug })
        .from(schema.workspaces)
        .innerJoin(schema.memberships, eq(schema.memberships.workspaceId, schema.workspaces.id))
        .where(
          and(
            eq(schema.memberships.userId, session.user.id),
            isNull(schema.workspaces.deletedAt),
            isNull(schema.memberships.deletedAt),
          ),
        )
        .limit(1);
      return rows[0]?.slug ?? null;
    });
    if (slug) {
      redirect(`/${slug}/inbox`);
    }
    redirect("/onboarding");
  }

  const brand = await getBrand();

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-12 p-8">
      <header className="flex items-center justify-between">
        <Brand brand={brand} variant="wordmark" />
        <nav className="flex items-center gap-3 text-sm text-zinc-400">
          <a href="/sign-in" className="hover:text-zinc-100">
            Sign in
          </a>
          <a
            href="/sign-up"
            className="rounded-md bg-blue-500 px-3 py-1.5 font-medium text-white hover:bg-blue-600"
          >
            Get started
          </a>
        </nav>
      </header>

      <section className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-tight">{brand.tagline}</h1>
        <p className="max-w-2xl text-zinc-400">
          Setter. Closer. CX. One platform that adapts to how your team actually sells —
          with an AI agent that operates the system on your behalf.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Multi-party commissions</CardTitle>
            <CardDescription>Built in, not bolted on</CardDescription>
          </CardHeader>
          <CardContent>
            Setter, closer, and CX splits — installment-based, with hold periods. Solo
            sellers get a one-recipient default. Same data model.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Agent-native</CardTitle>
            <CardDescription>An operator, not a chatbox</CardDescription>
          </CardHeader>
          <CardContent>
            {brand.agentPersona.name} acts as you. Same permissions, durable workflows,
            transparent tool calls, full audit.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Configurable funnel</CardTitle>
            <CardDescription>Your stages, your dispositions</CardDescription>
          </CardHeader>
          <CardContent>
            Speed-to-lead, show-up, pitch, close, and collected — all queries over one
            event stream. Configure stages to your workflow.
          </CardContent>
        </Card>
      </section>

      <footer className="mt-auto border-t border-zinc-800 pt-6 text-xs text-zinc-500">
        <span>{brand.name}</span>
        <span className="mx-2">·</span>
        <a href={`mailto:${brand.supportEmail}`} className="hover:text-zinc-300">
          {brand.supportEmail}
        </a>
      </footer>
    </main>
  );
}
