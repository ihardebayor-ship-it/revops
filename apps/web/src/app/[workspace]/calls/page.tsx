import { withTenant } from "@revops/db/client";
import { calls as callsDomain } from "@revops/domain";
import { EmptyState, PageHeader, Pill, Time } from "@revops/ui";
import { resolveWorkspaceBySlug } from "~/lib/workspace";

export default async function CallsListPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);

  const items = ctx.membership.subAccountId
    ? await withTenant(ctx.authCtx, (db) =>
        callsDomain.listCalls(db, {
          subAccountId: ctx.membership.subAccountId!,
          limit: 50,
        }),
      )
    : [];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Calls"
        description="Logged appointments and call outcomes."
        actions={
          <a
            href={`/${slug}/calls/new`}
            className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600"
          >
            New call
          </a>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          title="No calls logged yet."
          description="Click “New call” to log your first appointment."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">Contact</th>
                <th className="px-4 py-2 font-medium">Appointment</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-3">
                    <a
                      href={`/${slug}/calls/${c.id}`}
                      className="block hover:text-blue-400"
                    >
                      <div className="font-medium text-zinc-100">
                        {c.contactName || c.contactEmail || "Unknown contact"}
                      </div>
                      {c.contactEmail && c.contactName && (
                        <div className="text-xs text-zinc-500">{c.contactEmail}</div>
                      )}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {c.appointmentAt ? <Time value={c.appointmentAt} /> : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {c.completedAt ? (
                      <Pill variant="positive">Completed</Pill>
                    ) : c.showedAt ? (
                      <Pill variant="info">Showed</Pill>
                    ) : c.appointmentAt ? (
                      <Pill variant="info">Booked</Pill>
                    ) : (
                      <Pill>Draft</Pill>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {c.durationSeconds
                      ? `${Math.round(c.durationSeconds / 60)}m`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
