// Dispositions domain. Workspace-configurable taxonomy for call/sale
// outcomes. No version-on-write — dispositions are descriptive, not
// load-bearing for commission math, and any analytics that join on
// disposition slug stay correct because slug is treated as immutable.

import { and, asc, eq } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";

export async function listDispositions(db: Db, workspaceId: string) {
  return db
    .select({
      id: schema.dispositions.id,
      slug: schema.dispositions.slug,
      label: schema.dispositions.label,
      category: schema.dispositions.category,
      sortOrder: schema.dispositions.sortOrder,
      isActive: schema.dispositions.isActive,
    })
    .from(schema.dispositions)
    .where(eq(schema.dispositions.workspaceId, workspaceId))
    .orderBy(asc(schema.dispositions.sortOrder), asc(schema.dispositions.slug));
}

export type UpdateDispositionInput = {
  dispositionId: string;
  workspaceId: string;
  patch: {
    label?: string;
    sortOrder?: number;
    isActive?: number;
  };
};

export async function updateDisposition(db: Db, input: UpdateDispositionInput) {
  const [row] = await db
    .update(schema.dispositions)
    .set({
      ...(input.patch.label !== undefined && { label: input.patch.label }),
      ...(input.patch.sortOrder !== undefined && { sortOrder: input.patch.sortOrder }),
      ...(input.patch.isActive !== undefined && { isActive: input.patch.isActive }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.dispositions.id, input.dispositionId),
        eq(schema.dispositions.workspaceId, input.workspaceId),
      ),
    )
    .returning({ id: schema.dispositions.id });
  if (!row) throw new Error("Disposition not found");
  return { dispositionId: row.id };
}
