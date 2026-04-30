import { withTenant } from "@revops/db/client";
import { tasks as tasksDomain } from "@revops/domain";
import { resolveWorkspaceBySlug } from "~/lib/workspace";
import { CreateTaskButton } from "./create-task-button";

export default async function InboxPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);

  const result = ctx.membership.subAccountId
    ? await withTenant(ctx.authCtx, (db) =>
        tasksDomain.listTasks(db, {
          subAccountId: ctx.membership.subAccountId!,
          assignedUserId: ctx.authCtx.userId,
          salesRoleSlugs: [],
          statuses: ["open", "snoozed"],
          limit: 50,
        }),
      )
    : { items: [], nextCursor: null };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Tasks assigned to you in <span className="text-zinc-200">{ctx.workspace.name}</span>.
          </p>
        </div>
        <CreateTaskButton />
      </header>

      {result.items.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-12 text-center">
          <p className="text-sm text-zinc-400">Inbox zero — nothing to do right now.</p>
          <p className="mt-1 text-xs text-zinc-500">
            Try the “New task” button to add a follow-up.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
          {result.items.map((t) => (
            <li key={t.id} className="flex items-start gap-3 px-4 py-3">
              <div className="mt-1 h-2 w-2 rounded-full bg-blue-500" />
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-zinc-100">{t.title}</span>
                  <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs uppercase tracking-wider text-zinc-400">
                    {t.kind.replace(/_/g, " ")}
                  </span>
                </div>
                {t.description && (
                  <p className="mt-1 text-sm text-zinc-400">{t.description}</p>
                )}
                {t.dueAt && (
                  <p className="mt-1 text-xs text-zinc-500">
                    Due: {new Date(t.dueAt).toLocaleString()}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
