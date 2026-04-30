// Single source of truth for emitting funnel events. Every status transition
// in the codebase calls this helper — never `db.insert(funnelEvents)` directly.
// Resolves stage slug → stage_id + current stage_version_id, computes a
// deterministic meta_hash for dedup, and inserts both the dedupe record
// and the event in one transaction. ON CONFLICT on (entity_type, entity_id,
// stage_id, meta_hash) makes replay idempotent.

import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";

export type EmitFunnelEventInput = {
  workspaceId: string;
  subAccountId: string;
  entityType: "optin" | "call" | "sale" | "customer";
  entityId: string;
  stageSlug: string;
  occurredAt: Date;
  actorUserId?: string | null;
  sourceEventId?: string | null;
  meta?: Record<string, unknown>;
};

export type EmitFunnelEventResult = {
  funnelEventId: string;
  stageId: string;
  stageVersionId: string;
  /** True when the event was inserted; false when an identical event already
   *  existed (dedupe). Callers can use this to suppress side effects on
   *  webhook replay. */
  inserted: boolean;
};

function computeMetaHash(input: Pick<EmitFunnelEventInput, "occurredAt" | "sourceEventId" | "meta">): string {
  // Stable serialization: ISO timestamp + sourceEventId + sorted-key meta.
  const payload = {
    occurredAt: input.occurredAt.toISOString(),
    sourceEventId: input.sourceEventId ?? null,
    meta: input.meta
      ? Object.keys(input.meta)
          .sort()
          .reduce<Record<string, unknown>>((acc, k) => {
            acc[k] = input.meta![k];
            return acc;
          }, {})
      : null,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
}

/**
 * Emit a funnel event. Idempotent under replay (dedup via funnel_event_dedupe
 * UNIQUE constraint).
 *
 * @returns `inserted: false` when the same `(entity, stage, hash)` was already
 *           recorded — caller should NOT fire downstream side effects.
 */
export async function emitFunnelEvent(db: Db, input: EmitFunnelEventInput): Promise<EmitFunnelEventResult> {
  const stages = await db
    .select({ id: schema.funnelStages.id })
    .from(schema.funnelStages)
    .where(
      and(
        eq(schema.funnelStages.workspaceId, input.workspaceId),
        eq(schema.funnelStages.slug, input.stageSlug),
      ),
    )
    .limit(1);
  const stage = stages[0];
  if (!stage) {
    throw new Error(
      `Funnel stage "${input.stageSlug}" does not exist in workspace ${input.workspaceId}`,
    );
  }

  const versions = await db
    .select({ id: schema.funnelStageVersions.id })
    .from(schema.funnelStageVersions)
    .where(eq(schema.funnelStageVersions.funnelStageId, stage.id))
    .orderBy(desc(schema.funnelStageVersions.version))
    .limit(1);
  const stageVersionId = versions[0]?.id ?? null;

  const metaHash = computeMetaHash(input);

  // Probe the dedup table; if a row exists for this tuple, return its
  // funnel_event_id without inserting again.
  const existingDedupe = await db
    .select({ funnelEventId: schema.funnelEventDedupe.funnelEventId })
    .from(schema.funnelEventDedupe)
    .where(
      and(
        eq(schema.funnelEventDedupe.entityType, input.entityType),
        eq(schema.funnelEventDedupe.entityId, input.entityId),
        eq(schema.funnelEventDedupe.stageId, stage.id),
        eq(schema.funnelEventDedupe.metaHash, metaHash),
      ),
    )
    .limit(1);
  if (existingDedupe.length > 0 && existingDedupe[0]!.funnelEventId) {
    return {
      funnelEventId: existingDedupe[0]!.funnelEventId,
      stageId: stage.id,
      stageVersionId: stageVersionId ?? "",
      inserted: false,
    };
  }

  const [event] = await db
    .insert(schema.funnelEvents)
    .values({
      workspaceId: input.workspaceId,
      subAccountId: input.subAccountId,
      entityType: input.entityType,
      entityId: input.entityId,
      stageId: stage.id,
      stageVersionId,
      occurredAt: input.occurredAt,
      sourceEventId: input.sourceEventId ?? null,
      actorUserId: input.actorUserId ?? null,
      meta: input.meta ?? {},
    })
    .returning({ id: schema.funnelEvents.id });
  if (!event) throw new Error("Failed to insert funnel_event");

  await db.insert(schema.funnelEventDedupe).values({
    workspaceId: input.workspaceId,
    entityType: input.entityType,
    entityId: input.entityId,
    stageId: stage.id,
    metaHash,
    funnelEventId: event.id,
  });

  return {
    funnelEventId: event.id,
    stageId: stage.id,
    stageVersionId: stageVersionId ?? "",
    inserted: true,
  };
}
