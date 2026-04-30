// Sales-roles domain. Phase-1 M1 ships list + update with version-on-write.
// Each update inserts a new sales_role_versions row before mutating the
// canonical row, so commission_entries that reference an older version_id
// continue to compute against the role state that produced them.

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";

export async function listRoles(db: Db, workspaceId: string) {
  return db
    .select({
      id: schema.salesRoles.id,
      slug: schema.salesRoles.slug,
      label: schema.salesRoles.label,
      stageOwnership: schema.salesRoles.stageOwnership,
      defaultCommissionShare: schema.salesRoles.defaultCommissionShare,
      defaultSlaSeconds: schema.salesRoles.defaultSlaSeconds,
      sortOrder: schema.salesRoles.sortOrder,
      color: schema.salesRoles.color,
      icon: schema.salesRoles.icon,
    })
    .from(schema.salesRoles)
    .where(
      and(
        eq(schema.salesRoles.workspaceId, workspaceId),
        isNull(schema.salesRoles.deletedAt),
      ),
    )
    .orderBy(asc(schema.salesRoles.sortOrder), asc(schema.salesRoles.slug));
}

export type UpdateRoleInput = {
  roleId: string;
  workspaceId: string;
  actorUserId: string;
  patch: {
    label?: string;
    stageOwnership?: string[];
    defaultCommissionShare?: string;
    defaultSlaSeconds?: number | null;
    color?: string | null;
    icon?: string | null;
  };
};

export async function updateRole(db: Db, input: UpdateRoleInput) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.salesRoles)
      .where(
        and(
          eq(schema.salesRoles.id, input.roleId),
          eq(schema.salesRoles.workspaceId, input.workspaceId),
          isNull(schema.salesRoles.deletedAt),
        ),
      )
      .limit(1);
    if (!current) throw new Error("Sales role not found");

    const next = {
      label: input.patch.label ?? current.label,
      stageOwnership: input.patch.stageOwnership ?? current.stageOwnership,
      defaultCommissionShare:
        input.patch.defaultCommissionShare ?? current.defaultCommissionShare,
      defaultSlaSeconds:
        input.patch.defaultSlaSeconds === undefined
          ? current.defaultSlaSeconds
          : input.patch.defaultSlaSeconds,
      color: input.patch.color === undefined ? current.color : input.patch.color,
      icon: input.patch.icon === undefined ? current.icon : input.patch.icon,
    };

    // Bump version: snapshot the *next* state into sales_role_versions.
    const [latestVersion] = await tx
      .select({ version: schema.salesRoleVersions.version })
      .from(schema.salesRoleVersions)
      .where(eq(schema.salesRoleVersions.salesRoleId, input.roleId))
      .orderBy(desc(schema.salesRoleVersions.version))
      .limit(1);
    const nextVersion = (latestVersion?.version ?? 0) + 1;

    await tx.insert(schema.salesRoleVersions).values({
      salesRoleId: input.roleId,
      version: nextVersion,
      snapshot: {
        slug: current.slug,
        label: next.label,
        stageOwnership: next.stageOwnership,
        defaultCommissionShare: next.defaultCommissionShare,
        defaultSlaSeconds: next.defaultSlaSeconds,
      },
      createdBy: input.actorUserId,
    });

    await tx
      .update(schema.salesRoles)
      .set({
        ...next,
        updatedAt: new Date(),
      })
      .where(eq(schema.salesRoles.id, input.roleId));

    return { roleId: input.roleId, newVersion: nextVersion };
  });
}
