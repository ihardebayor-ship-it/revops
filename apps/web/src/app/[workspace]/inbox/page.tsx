import { withTenant } from "@revops/db/client";
import { tasks as tasksDomain } from "@revops/domain";
import { EmptyState, PageHeader, Pill, Time } from "@revops/ui";
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
      <PageHeader
        title="Inbox"
        description={`Tasks assigned to you in ${ctx.workspace.name}.`}
        actions={<CreateTaskButton />}
      />

      {result.items.length === 0 ? (
        <EmptyState
          title="Inbox zero — nothing to do right now."
          description="Try the “New task” button to add a follow-up."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-800 rounded-lg border border-zinc-800 bg-zinc-950">
          {result.items.map((t) => (
            <li key={t.id} className="flex items-start gap-3 px-4 py-3">
              <div className="mt-1 h-2 w-2 rounded-full bg-blue-500" />
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-zinc-100">{t.title}</span>
                  <Pill>{t.kind.replace(/_/g, " ")}</Pill>
                </div>
                {t.description && (
                  <p className="mt-1 text-sm text-zinc-400">{t.description}</p>
                )}
                {t.dueAt && (
                  <p className="mt-1 text-xs text-zinc-500">
                    Due: <Time value={t.dueAt} />
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
