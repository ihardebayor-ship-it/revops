import { Brand } from "@revops/ui";
import { getBrand } from "~/lib/brand";
import { resolveWorkspaceBySlug } from "~/lib/workspace";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);
  const brand = await getBrand(ctx.workspace.id);

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
        <div className="border-b border-zinc-800 px-4 py-4">
          <Brand brand={brand} variant="wordmark" />
          <p className="mt-1 text-xs text-zinc-500">{ctx.workspace.name}</p>
        </div>
        <nav className="flex flex-col gap-1 px-2 py-4 text-sm">
          <a
            href={`/${slug}/inbox`}
            className="rounded-md px-3 py-2 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-50"
          >
            Inbox
          </a>
          <a
            href={`/${slug}/agent`}
            className="rounded-md px-3 py-2 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-50"
          >
            Agent
          </a>
          <a
            href={`/${slug}/settings/roles`}
            className="rounded-md px-3 py-2 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-50"
          >
            Settings
          </a>
        </nav>
        <div className="mt-auto border-t border-zinc-800 px-4 py-3 text-xs text-zinc-500">
          {ctx.membership.accessRole && (
            <span className="rounded bg-zinc-900 px-2 py-1 uppercase tracking-wider">
              {ctx.membership.accessRole.replace("_", " ")}
            </span>
          )}
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
