import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { withTenant, schema } from "@revops/db/client";
import { calls as callsDomain, dispositions as dispositionsDomain } from "@revops/domain";
import { PageHeader, Pill, Time } from "@revops/ui";
import { resolveWorkspaceBySlug } from "~/lib/workspace";
import { CallDetailActions } from "./call-detail-actions";

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ workspace: string; callId: string }>;
}) {
  const { workspace: slug, callId } = await params;
  const ctx = await resolveWorkspaceBySlug(slug);

  const call = await withTenant(ctx.authCtx, (db) =>
    callsDomain.getCall(db, { callId, workspaceId: ctx.workspace.id }),
  );
  if (!call) {
    notFound();
  }

  const dispositions = await withTenant(ctx.authCtx, (db) =>
    dispositionsDomain.listDispositions(db, ctx.workspace.id),
  );

  // Funnel events for this call (for the timeline strip).
  const events = await withTenant(ctx.authCtx, (db) =>
    db
      .select({
        id: schema.funnelEvents.id,
        stageId: schema.funnelEvents.stageId,
        occurredAt: schema.funnelEvents.occurredAt,
        meta: schema.funnelEvents.meta,
      })
      .from(schema.funnelEvents)
      .where(
        and(
          eq(schema.funnelEvents.entityType, "call"),
          eq(schema.funnelEvents.entityId, callId),
        ),
      )
      .orderBy(schema.funnelEvents.occurredAt),
  );

  const stages = await withTenant(ctx.authCtx, (db) =>
    db
      .select({
        id: schema.funnelStages.id,
        slug: schema.funnelStages.slug,
        label: schema.funnelStages.label,
      })
      .from(schema.funnelStages)
      .where(eq(schema.funnelStages.workspaceId, ctx.workspace.id)),
  );
  const stageMap = new Map(stages.map((s) => [s.id, s]));

  const currentDisposition = call.dispositionId
    ? dispositions.find((d) => d.id === call.dispositionId)
    : null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={call.contactName || call.contactEmail || "Call"}
        description={call.contactEmail ?? undefined}
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Appointment</p>
          <p className="mt-1 text-sm text-zinc-100">
            {call.appointmentAt ? <Time value={call.appointmentAt} /> : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Status</p>
          <p className="mt-1 text-sm text-zinc-100">
            {call.completedAt ? "Completed" : call.showedAt ? "Showed" : "Booked"}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Disposition</p>
          <p className="mt-1 text-sm text-zinc-100">
            {currentDisposition ? (
              <Pill variant={categoryVariant(currentDisposition.category)}>
                {currentDisposition.label}
              </Pill>
            ) : (
              "—"
            )}
          </p>
        </div>
      </section>

      <CallDetailActions
        slug={slug}
        callId={callId}
        dispositions={dispositions}
        currentDispositionId={call.dispositionId ?? null}
        showedAt={call.showedAt ? call.showedAt.toISOString() : null}
        completedAt={call.completedAt ? call.completedAt.toISOString() : null}
      />

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">Timeline</h2>
        {events.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
            No funnel events yet. Set the appointment, mark showed, or set a winning disposition.
          </p>
        ) : (
          <ol className="space-y-1 rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm">
            {events.map((e) => {
              const stage = e.stageId ? stageMap.get(e.stageId) : null;
              return (
                <li key={e.id} className="flex items-center gap-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                  <span className="text-zinc-300">{stage?.label ?? "stage"}</span>
                  <span className="ml-auto text-xs text-zinc-500">
                    <Time value={e.occurredAt} />
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {call.notes && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-zinc-300">Notes</h2>
          <p className="whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-300">
            {call.notes}
          </p>
        </section>
      )}
    </div>
  );
}

function categoryVariant(
  category: string,
): "positive" | "won" | "objection" | "disqualification" | "neutral" {
  if (category === "positive" || category === "won" || category === "objection" || category === "disqualification") {
    return category;
  }
  return "neutral";
}
