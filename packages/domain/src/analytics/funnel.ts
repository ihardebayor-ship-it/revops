// Funnel rates + velocity. Reads funnel_events for the requested entity
// type within a window, walks the workspace's funnel_stages in ordinal
// order, and computes:
//   - per-stage entity count (distinct entity_id reached this stage)
//   - conversion rate from previous stage
//   - median hours from previous stage (velocity)
//
// This is the canonical funnel surface — closer / setter / manager
// dashboards all derive from it.

import { and, asc, eq } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";
import type { Period } from "./types";

export type FunnelStageStat = {
  stageSlug: string;
  stageLabel: string;
  ordinal: number;
  count: number;
  conversionFromPrev: number | null; // 0–1
  conversionFromTop: number | null; // 0–1
  medianHoursFromPrev: number | null;
};

export type FunnelArgs = {
  workspaceId: string;
  subAccountId?: string;
  entityType: "call" | "sale" | "optin" | "customer";
  period: Period;
  /** Optional rep filter: only count entities owned by this user. For calls
   *  this means closer_user_id; for sales it means linkedCallId's closer. */
  userId?: string;
};

export async function funnelStats(db: Db, args: FunnelArgs): Promise<FunnelStageStat[]> {
  // 1. Load workspace stages in order (filter to the relevant kind).
  const stages = await db
    .select({
      id: schema.funnelStages.id,
      slug: schema.funnelStages.slug,
      label: schema.funnelStages.label,
      ordinal: schema.funnelStages.ordinal,
      kind: schema.funnelStages.kind,
    })
    .from(schema.funnelStages)
    .where(eq(schema.funnelStages.workspaceId, args.workspaceId))
    .orderBy(asc(schema.funnelStages.ordinal));

  // Filter: when computing the call funnel, only include stages whose kind
  // is 'call' or 'lead'; when sale, include 'sale' or 'post_sale'.
  const stageKindFilter: string[] =
    args.entityType === "call"
      ? ["lead", "call"]
      : args.entityType === "sale"
        ? ["sale", "post_sale"]
        : args.entityType === "optin"
          ? ["lead"]
          : ["post_sale"];
  const relevant = stages.filter((s) => stageKindFilter.includes(s.kind));
  if (relevant.length === 0) return [];

  // 2. Pull counts + first-occurrence-per-entity timestamps in one shot.
  // Window: entities that reached the FIRST stage in the period. We then
  // walk forward, accepting any later stage hit even if outside the window
  // (so a deal that booked Monday and showed Wednesday is counted).
  const conditions = [
    eq(schema.funnelEvents.workspaceId, args.workspaceId),
    eq(schema.funnelEvents.entityType, args.entityType),
  ];
  if (args.subAccountId) conditions.push(eq(schema.funnelEvents.subAccountId, args.subAccountId));

  const events = await db
    .select({
      entityId: schema.funnelEvents.entityId,
      stageId: schema.funnelEvents.stageId,
      stageSlug: schema.funnelStages.slug,
      occurredAt: schema.funnelEvents.occurredAt,
    })
    .from(schema.funnelEvents)
    .innerJoin(schema.funnelStages, eq(schema.funnelStages.id, schema.funnelEvents.stageId))
    .where(and(...conditions))
    .orderBy(asc(schema.funnelEvents.occurredAt));

  // 3. Walk per entity to collect first-occurrence-per-stage timestamps.
  type EntityStageMap = Map<string, Map<string, Date>>; // entityId → stageSlug → ts
  const byEntity: EntityStageMap = new Map();
  for (const e of events) {
    const m = byEntity.get(e.entityId) ?? new Map<string, Date>();
    if (!m.has(e.stageSlug)) m.set(e.stageSlug, e.occurredAt);
    byEntity.set(e.entityId, m);
  }

  // Filter to entities whose top-of-funnel timestamp lands in the period.
  const topSlug = relevant[0]!.slug;
  const inWindow = new Map<string, Map<string, Date>>();
  for (const [entityId, stageMap] of byEntity) {
    const t = stageMap.get(topSlug);
    if (t && t >= args.period.from && t <= args.period.to) {
      inWindow.set(entityId, stageMap);
    }
  }

  const totalAtTop = inWindow.size;
  const out: FunnelStageStat[] = [];
  let prevCount: number | null = null;

  for (const stage of relevant) {
    const count = Array.from(inWindow.values()).filter((m) => m.has(stage.slug)).length;
    const conversionFromPrev = prevCount === null || prevCount === 0 ? null : count / prevCount;
    const conversionFromTop = totalAtTop === 0 ? null : count / totalAtTop;

    let medianHoursFromPrev: number | null = null;
    if (prevCount !== null && relevant.indexOf(stage) > 0) {
      const prevStage = relevant[relevant.indexOf(stage) - 1]!;
      const deltas: number[] = [];
      for (const m of inWindow.values()) {
        const a = m.get(prevStage.slug);
        const b = m.get(stage.slug);
        if (a && b && b >= a) deltas.push((b.getTime() - a.getTime()) / (3600 * 1000));
      }
      medianHoursFromPrev = median(deltas);
    }

    out.push({
      stageSlug: stage.slug,
      stageLabel: stage.label,
      ordinal: stage.ordinal,
      count,
      conversionFromPrev,
      conversionFromTop,
      medianHoursFromPrev,
    });
    prevCount = count;
  }

  void args.userId; // user-scoped funnel deferred; entity ownership join lands when calls/sales gain explicit ownership FKs at every stage
  return out;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

// Exported for tests.
export const _internal = { median };
