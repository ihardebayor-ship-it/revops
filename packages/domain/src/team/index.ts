// Team management — workspace members + pending invitations + sales-role
// assignments. Workspace admins call these from /settings/team.

import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";

// Mirrors @revops/auth/policy AccessRole. Inlined so the domain package
// stays free of auth deps (the dep direction is auth → domain via the
// onboarding bootstrap; reversing it would create a cycle).
type AccessRole =
  | "superadmin"
  | "workspace_admin"
  | "sub_account_admin"
  | "manager"
  | "contributor"
  | "viewer";

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export type TeamMember = {
  membershipId: string;
  userId: string;
  email: string;
  name: string | null;
  accessRole: AccessRole;
  acceptedAt: Date | null;
  createdAt: Date;
  salesRoleIds: string[];
};

export type TeamInvitation = {
  id: string;
  email: string;
  accessRole: AccessRole;
  salesRoleIds: string[];
  invitedByUserId: string | null;
  invitedAt: Date;
  expiresAt: Date;
  token: string;
};

export async function listTeam(
  db: Db,
  args: { workspaceId: string; subAccountId?: string | null },
): Promise<{ members: TeamMember[]; invitations: TeamInvitation[] }> {
  const memberConditions = [
    eq(schema.memberships.workspaceId, args.workspaceId),
    isNull(schema.memberships.deletedAt),
  ];
  if (args.subAccountId) {
    memberConditions.push(eq(schema.memberships.subAccountId, args.subAccountId));
  }

  const memberRows = await db
    .select({
      membershipId: schema.memberships.id,
      userId: schema.memberships.userId,
      email: schema.user.email,
      name: schema.user.name,
      accessRole: schema.memberships.accessRole,
      acceptedAt: schema.memberships.acceptedAt,
      createdAt: schema.memberships.createdAt,
    })
    .from(schema.memberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.memberships.userId))
    .where(and(...memberConditions))
    .orderBy(asc(schema.memberships.createdAt));

  // Pull all sales-role assignments for these users in this workspace.
  const assignmentConditions = [
    eq(schema.salesRoleAssignments.workspaceId, args.workspaceId),
    isNull(schema.salesRoleAssignments.deletedAt),
  ];
  if (args.subAccountId) {
    assignmentConditions.push(eq(schema.salesRoleAssignments.subAccountId, args.subAccountId));
  }

  const assignments = await db
    .select({
      userId: schema.salesRoleAssignments.userId,
      salesRoleId: schema.salesRoleAssignments.salesRoleId,
    })
    .from(schema.salesRoleAssignments)
    .where(and(...assignmentConditions));
  const byUser = new Map<string, string[]>();
  for (const a of assignments) {
    const list = byUser.get(a.userId) ?? [];
    list.push(a.salesRoleId);
    byUser.set(a.userId, list);
  }

  const members: TeamMember[] = memberRows.map((m) => ({
    ...m,
    salesRoleIds: byUser.get(m.userId) ?? [],
  }));

  const invitationConditions = [
    eq(schema.workspaceInvitations.workspaceId, args.workspaceId),
    isNull(schema.workspaceInvitations.acceptedAt),
    isNull(schema.workspaceInvitations.revokedAt),
    gt(schema.workspaceInvitations.expiresAt, new Date()),
  ];
  if (args.subAccountId) {
    invitationConditions.push(eq(schema.workspaceInvitations.subAccountId, args.subAccountId));
  }

  const inviteRows = await db
    .select({
      id: schema.workspaceInvitations.id,
      email: schema.workspaceInvitations.email,
      accessRole: schema.workspaceInvitations.accessRole,
      salesRoleIds: schema.workspaceInvitations.salesRoleIds,
      invitedByUserId: schema.workspaceInvitations.invitedBy,
      invitedAt: schema.workspaceInvitations.createdAt,
      expiresAt: schema.workspaceInvitations.expiresAt,
      token: schema.workspaceInvitations.token,
    })
    .from(schema.workspaceInvitations)
    .where(and(...invitationConditions))
    .orderBy(desc(schema.workspaceInvitations.createdAt));

  return { members, invitations: inviteRows };
}

export type InviteMemberInput = {
  workspaceId: string;
  subAccountId: string | null;
  invitedBy: string;
  email: string;
  accessRole: AccessRole;
  salesRoleIds?: string[];
};

export async function inviteMember(db: Db, input: InviteMemberInput): Promise<TeamInvitation> {
  const email = input.email.toLowerCase().trim();
  if (!email.includes("@")) throw new Error("Invalid email");
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  // If a user already exists with this email AND has a membership in this
  // workspace, reject early — they're already on the team.
  const [existingUser] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);
  if (existingUser) {
    const [existingMember] = await db
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.userId, existingUser.id),
          eq(schema.memberships.workspaceId, input.workspaceId),
          isNull(schema.memberships.deletedAt),
        ),
      )
      .limit(1);
    if (existingMember) {
      throw new Error(`${email} is already a member of this workspace`);
    }
  }

  // Upsert by (workspace_id, email): re-inviting refreshes the token + role.
  const [row] = await db
    .insert(schema.workspaceInvitations)
    .values({
      workspaceId: input.workspaceId,
      subAccountId: input.subAccountId,
      email,
      accessRole: input.accessRole,
      salesRoleIds: input.salesRoleIds ?? [],
      invitedBy: input.invitedBy,
      token,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [schema.workspaceInvitations.workspaceId, schema.workspaceInvitations.email],
      set: {
        accessRole: input.accessRole,
        salesRoleIds: input.salesRoleIds ?? [],
        invitedBy: input.invitedBy,
        token,
        expiresAt,
        revokedAt: null,
        acceptedAt: null,
        acceptedByUserId: null,
      },
    })
    .returning({
      id: schema.workspaceInvitations.id,
      email: schema.workspaceInvitations.email,
      accessRole: schema.workspaceInvitations.accessRole,
      salesRoleIds: schema.workspaceInvitations.salesRoleIds,
      invitedByUserId: schema.workspaceInvitations.invitedBy,
      invitedAt: schema.workspaceInvitations.createdAt,
      expiresAt: schema.workspaceInvitations.expiresAt,
      token: schema.workspaceInvitations.token,
    });
  if (!row) throw new Error("Failed to insert invitation");
  return row;
}

export async function revokeInvitation(
  db: Db,
  args: { invitationId: string; workspaceId: string },
): Promise<{ revoked: boolean }> {
  const result = await db
    .update(schema.workspaceInvitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.workspaceInvitations.id, args.invitationId),
        eq(schema.workspaceInvitations.workspaceId, args.workspaceId),
        isNull(schema.workspaceInvitations.revokedAt),
        isNull(schema.workspaceInvitations.acceptedAt),
      ),
    )
    .returning({ id: schema.workspaceInvitations.id });
  return { revoked: result.length > 0 };
}

export async function removeMember(
  db: Db,
  args: { membershipId: string; workspaceId: string; actorUserId: string },
): Promise<{ removed: boolean }> {
  // Find target membership + the user behind it.
  const [target] = await db
    .select({ id: schema.memberships.id, userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.id, args.membershipId),
        eq(schema.memberships.workspaceId, args.workspaceId),
        isNull(schema.memberships.deletedAt),
      ),
    )
    .limit(1);
  if (!target) return { removed: false };
  if (target.userId === args.actorUserId) {
    throw new Error("Cannot remove yourself from the workspace");
  }

  // Soft-delete membership.
  await db
    .update(schema.memberships)
    .set({ deletedAt: new Date() })
    .where(eq(schema.memberships.id, args.membershipId));

  // Soft-delete sales-role assignments for this user in this workspace.
  await db
    .update(schema.salesRoleAssignments)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(schema.salesRoleAssignments.userId, target.userId),
        eq(schema.salesRoleAssignments.workspaceId, args.workspaceId),
        isNull(schema.salesRoleAssignments.deletedAt),
      ),
    );
  return { removed: true };
}

export type UpdateMemberInput = {
  membershipId: string;
  workspaceId: string;
  patch: {
    accessRole?: AccessRole;
    salesRoleIds?: string[];
  };
};

export async function updateMember(db: Db, input: UpdateMemberInput) {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({
        id: schema.memberships.id,
        userId: schema.memberships.userId,
        subAccountId: schema.memberships.subAccountId,
      })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.id, input.membershipId),
          eq(schema.memberships.workspaceId, input.workspaceId),
          isNull(schema.memberships.deletedAt),
        ),
      )
      .limit(1);
    if (!target) throw new Error("Membership not found");

    if (input.patch.accessRole) {
      await tx
        .update(schema.memberships)
        .set({ accessRole: input.patch.accessRole, updatedAt: new Date() })
        .where(eq(schema.memberships.id, input.membershipId));
    }

    if (input.patch.salesRoleIds && target.subAccountId) {
      // Soft-delete any current assignments not in the new list.
      const desired = new Set(input.patch.salesRoleIds);
      const current = await tx
        .select({
          id: schema.salesRoleAssignments.id,
          salesRoleId: schema.salesRoleAssignments.salesRoleId,
        })
        .from(schema.salesRoleAssignments)
        .where(
          and(
            eq(schema.salesRoleAssignments.userId, target.userId),
            eq(schema.salesRoleAssignments.workspaceId, input.workspaceId),
            isNull(schema.salesRoleAssignments.deletedAt),
          ),
        );
      const existing = new Set(current.map((c) => c.salesRoleId));
      // Remove any current that isn't desired.
      for (const c of current) {
        if (!desired.has(c.salesRoleId)) {
          await tx
            .update(schema.salesRoleAssignments)
            .set({ deletedAt: new Date() })
            .where(eq(schema.salesRoleAssignments.id, c.id));
        }
      }
      // Insert any desired that doesn't exist yet.
      for (const roleId of desired) {
        if (!existing.has(roleId)) {
          await tx
            .insert(schema.salesRoleAssignments)
            .values({
              userId: target.userId,
              salesRoleId: roleId,
              subAccountId: target.subAccountId,
              workspaceId: input.workspaceId,
            })
            .onConflictDoNothing();
        }
      }
    }

    return { membershipId: input.membershipId };
  });
}

void sql; // kept for future raw queries
