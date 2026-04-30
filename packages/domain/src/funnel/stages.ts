// Funnel-stage CRUD with version-on-write. Same model as sales_roles:
// updates snapshot the next state into funnel_stage_versions, so older
// funnel_events that reference a stale version_id remain interpretable.

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";

export async function listStages(db: Db, workspaceId: string) {
  return db
    .select({
      id: schema.funnelStages.id,
      slug: schema.funnelStages.slug,
      label: schema.funnelStages.label,
      kind: schema.funnelStages.kind,
      ordinal: schema.funnelStages.ordinal,
    })
    .from(schema.funnelStages)
    .where(
      and(
        eq(schema.funnelStages.workspaceId, workspaceId),
        isNull(schema.funnelStages.deletedAt),
      ),
    )
    .orderBy(asc(schema.funnelStages.ordinal));
}

export type UpdateStageInput = {
  stageId: string;
  workspaceId: string;
  actorUserId: string;
  patch: {
    label?: string;
    ordinal?: number;
  };
};

export async function updateStage(db: Db, input: UpdateStageInput) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.funnelStages)
      .where(
        and(
          eq(schema.funnelStages.id, input.stageId),
          eq(schema.funnelStages.workspaceId, input.workspaceId),
          isNull(schema.funnelStages.deletedAt),
        ),
      )
      .limit(1);
    if (!current) throw new Error("Funnel stage not found");

    const next = {
      label: input.patch.label ?? current.label,
      ordinal: input.patch.ordinal ?? current.ordinal,
    };

    const [latestVersion] = await tx
      .select({ version: schema.funnelStageVersions.version })
      .from(schema.funnelStageVersions)
      .where(eq(schema.funnelStageVersions.funnelStageId, input.stageId))
      .orderBy(desc(schema.funnelStageVersions.version))
      .limit(1);
    const nextVersion = (latestVersion?.version ?? 0) + 1;

    await tx.insert(schema.funnelStageVersions).values({
      funnelStageId: input.stageId,
      version: nextVersion,
      snapshot: {
        slug: current.slug,
        label: next.label,
        kind: current.kind,
        ordinal: next.ordinal,
      },
    });

    await tx
      .update(schema.funnelStages)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(schema.funnelStages.id, input.stageId));

    return { stageId: input.stageId, newVersion: nextVersion };
  });
}
