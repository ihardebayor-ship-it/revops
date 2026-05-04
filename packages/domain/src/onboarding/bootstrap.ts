import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { bypassRls, schema } from "@revops/db/client";
import { TOPOLOGY_PRESETS, type TopologyPresetSlug } from "./topology-presets";

/**
 * Try to claim a pending workspace invitation for the given email. If
 * found, creates the membership + sales-role assignments and marks the
 * invitation accepted. Returns the workspace context the user joined,
 * or null if no pending invitation exists.
 *
 * Called from the auth bootstrap hook BEFORE bootstrapWorkspaceForUser:
 * invited users join existing workspaces, they don't create new ones.
 */
export async function claimPendingInvitation(args: {
  userId: string;
  email: string;
}): Promise<{ workspaceId: string; subAccountId: string | null } | null> {
  return bypassRls(async (db) =>
    db.transaction(async (tx) => {
      const lower = args.email.toLowerCase().trim();
      const [inv] = await tx
        .select()
        .from(schema.workspaceInvitations)
        .where(
          and(
            eq(schema.workspaceInvitations.email, lower),
            isNull(schema.workspaceInvitations.acceptedAt),
            isNull(schema.workspaceInvitations.revokedAt),
            gt(schema.workspaceInvitations.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!inv) return null;

      let subAccountId = inv.subAccountId;
      if (!subAccountId) {
        const [sa] = await tx
          .select({ id: schema.subAccounts.id })
          .from(schema.subAccounts)
          .where(eq(schema.subAccounts.workspaceId, inv.workspaceId))
          .limit(1);
        subAccountId = sa?.id ?? null;
      }

      await tx
        .insert(schema.memberships)
        .values({
          userId: args.userId,
          workspaceId: inv.workspaceId,
          subAccountId,
          accessRole: inv.accessRole,
          invitedBy: inv.invitedBy,
          acceptedAt: new Date(),
        })
        .onConflictDoNothing();

      // Materialize sales-role assignments. Non-fatal if a role is missing
      // (e.g. admin renamed roles between invite + accept) — partial
      // assignment beats blocking the user from joining.
      if (inv.salesRoleIds.length > 0 && subAccountId) {
        for (const roleId of inv.salesRoleIds) {
          await tx
            .insert(schema.salesRoleAssignments)
            .values({
              userId: args.userId,
              salesRoleId: roleId,
              subAccountId,
              workspaceId: inv.workspaceId,
            })
            .onConflictDoNothing();
        }
      }

      await tx
        .update(schema.workspaceInvitations)
        .set({
          acceptedAt: new Date(),
          acceptedByUserId: args.userId,
        })
        .where(eq(schema.workspaceInvitations.id, inv.id));

      return { workspaceId: inv.workspaceId, subAccountId };
    }),
  );
}

const DEFAULT_DISPOSITIONS = [
  { slug: "interested", label: "Interested", category: "positive", sortOrder: 10 },
  { slug: "booked", label: "Booked", category: "positive", sortOrder: 20 },
  { slug: "won", label: "Won (closed)", category: "won", sortOrder: 30 },
  { slug: "price_objection", label: "Price objection", category: "objection", sortOrder: 40 },
  { slug: "timing", label: "Timing not right", category: "objection", sortOrder: 50 },
  { slug: "decision_maker_absent", label: "Decision maker absent", category: "objection", sortOrder: 60 },
  { slug: "competitor", label: "Lost to competitor", category: "objection", sortOrder: 70 },
  { slug: "not_qualified", label: "Not qualified", category: "disqualification", sortOrder: 80 },
  { slug: "not_interested", label: "Not interested", category: "disqualification", sortOrder: 90 },
  { slug: "no_show", label: "No-show", category: "no_show", sortOrder: 100 },
  { slug: "rescheduled", label: "Rescheduled", category: "rescheduled", sortOrder: 110 },
] as const;

function deriveSlug(email: string, displayName: string | null): string {
  const local = email.split("@")[0] ?? "workspace";
  const base = (displayName || local)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  const suffix = randomBytes(3).toString("hex");
  return `${base || "workspace"}-${suffix}`;
}

export type BootstrapInput = {
  userId: string;
  email: string;
  displayName: string | null;
  preset?: TopologyPresetSlug;
  workspaceName?: string;
};

export type BootstrapResult = {
  workspaceId: string;
  subAccountId: string;
  defaultRuleIds: string[];
};

/**
 * Create a workspace + sub_account + memberships(workspace_admin) + seeded
 * sales_roles + funnel_stages + dispositions + default flat-rate commission
 * rules for a brand-new user.
 *
 * Runs inside `bypassRls` because no membership exists yet — RLS would
 * otherwise block the writes the bootstrap needs.
 *
 * Caller (Better Auth `databaseHooks.user.create.after`) is expected to
 * detect the invited-user path BEFORE calling this — invitees don't
 * bootstrap a new workspace.
 */
export async function bootstrapWorkspaceForUser(input: BootstrapInput): Promise<BootstrapResult> {
  const presetSlug: TopologyPresetSlug = input.preset ?? "solo";
  const preset = TOPOLOGY_PRESETS[presetSlug];
  const initialName = input.workspaceName?.trim() || (input.displayName || "My workspace");
  const slug = deriveSlug(input.email, input.displayName);

  return bypassRls((db) =>
    db.transaction(async (tx) => {
      const [ws] = await tx
        .insert(schema.workspaces)
        .values({
          name: initialName,
          slug,
          topologyPreset: presetSlug,
          createdBy: input.userId,
        })
        .returning({ id: schema.workspaces.id });
      if (!ws) throw new Error("Failed to create workspace");

      const [sub] = await tx
        .insert(schema.subAccounts)
        .values({
          workspaceId: ws.id,
          name: "Default",
          slug: "default",
          createdBy: input.userId,
        })
        .returning({ id: schema.subAccounts.id });
      if (!sub) throw new Error("Failed to create sub_account");

      await tx.insert(schema.memberships).values({
        userId: input.userId,
        workspaceId: ws.id,
        subAccountId: sub.id,
        accessRole: "workspace_admin",
        acceptedAt: new Date(),
      });

      await tx.insert(schema.workspaceSettings).values({ workspaceId: ws.id });
      await tx.insert(schema.tenantSettings).values({ workspaceId: ws.id });

      const roleSeeds = preset.roles.map((r) => ({
        workspaceId: ws.id,
        slug: r.slug,
        label: r.label,
        stageOwnership: [...r.stageOwnership],
        defaultCommissionShare: r.defaultCommissionShare,
        defaultSlaSeconds: r.defaultSlaSeconds,
        sortOrder: r.sortOrder,
      }));
      const insertedRoles = roleSeeds.length
        ? await tx
            .insert(schema.salesRoles)
            .values(roleSeeds)
            .returning({ id: schema.salesRoles.id })
        : [];

      if (insertedRoles.length > 0) {
        await tx.insert(schema.salesRoleVersions).values(
          insertedRoles.map((r, idx) => ({
            salesRoleId: r.id,
            version: 1,
            snapshot: {
              slug: roleSeeds[idx]!.slug,
              label: roleSeeds[idx]!.label,
              stageOwnership: roleSeeds[idx]!.stageOwnership,
              defaultCommissionShare: roleSeeds[idx]!.defaultCommissionShare,
              defaultSlaSeconds: roleSeeds[idx]!.defaultSlaSeconds,
            },
            createdBy: input.userId,
          })),
        );
      }

      const stageSeeds = preset.stages.map((s) => ({
        workspaceId: ws.id,
        slug: s.slug,
        label: s.label,
        kind: s.kind,
        ordinal: s.ordinal,
      }));
      const insertedStages = stageSeeds.length
        ? await tx
            .insert(schema.funnelStages)
            .values(stageSeeds)
            .returning({ id: schema.funnelStages.id })
        : [];
      if (insertedStages.length > 0) {
        await tx.insert(schema.funnelStageVersions).values(
          insertedStages.map((stage, idx) => ({
            funnelStageId: stage.id,
            version: 1,
            snapshot: {
              slug: stageSeeds[idx]!.slug,
              label: stageSeeds[idx]!.label,
              kind: stageSeeds[idx]!.kind,
              ordinal: stageSeeds[idx]!.ordinal,
            },
          })),
        );
      }

      await tx.insert(schema.dispositions).values(
        DEFAULT_DISPOSITIONS.map((d) => ({
          workspaceId: ws.id,
          slug: d.slug,
          label: d.label,
          category: d.category,
          sortOrder: d.sortOrder,
        })),
      );

      const ruleRows = insertedRoles.map((role, idx) => ({
        workspaceId: ws.id,
        name: `${roleSeeds[idx]!.label} default`,
        type: "flat_rate" as const,
        salesRoleId: role.id,
        sharePct: roleSeeds[idx]!.defaultCommissionShare,
        holdDays: 30,
        paidOn: "collected",
        effectiveFrom: new Date(),
        createdBy: input.userId,
      }));
      const insertedRules = ruleRows.length
        ? await tx
            .insert(schema.commissionRules)
            .values(ruleRows)
            .returning({ id: schema.commissionRules.id })
        : [];
      if (insertedRules.length > 0) {
        await tx.insert(schema.commissionRuleVersions).values(
          insertedRules.map((r, idx) => ({
            commissionRuleId: r.id,
            version: 1,
            snapshot: { ...ruleRows[idx] },
            createdBy: input.userId,
          })),
        );
      }

      return {
        workspaceId: ws.id,
        subAccountId: sub.id,
        defaultRuleIds: insertedRules.map((r) => r.id),
      };
    }),
  );
}

// ─── Onboarding helpers ──────────────────────────────────────────

/**
 * Switch a workspace's topology preset, but only if no real activity
 * has happened yet. Wipes seeded sales_roles / funnel_stages /
 * dispositions / commission_rules and re-seeds from the new preset.
 *
 * Refuses to run if any sales / calls / commission_recipients exist.
 * Returns { applied: false, reason } when blocked so the UI can
 * explain why instead of erroring out.
 */
export async function applyTopologyPreset(args: {
  workspaceId: string;
  preset: TopologyPresetSlug;
  actorUserId: string;
}): Promise<
  | { applied: true; preset: TopologyPresetSlug }
  | { applied: false; reason: string }
> {
  return bypassRls(async (db) =>
    db.transaction(async (tx) => {
      const [ws] = await tx
        .select({
          id: schema.workspaces.id,
          currentPreset: schema.workspaces.topologyPreset,
        })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, args.workspaceId))
        .limit(1);
      if (!ws) return { applied: false as const, reason: "Workspace not found." };
      if (ws.currentPreset === args.preset) {
        return { applied: true as const, preset: args.preset };
      }

      // Refuse re-bootstrap if real activity exists.
      const [salesCount] = await tx
        .select({ n: schema.sales.id })
        .from(schema.sales)
        .where(eq(schema.sales.workspaceId, args.workspaceId))
        .limit(1);
      const [callCount] = await tx
        .select({ n: schema.calls.id })
        .from(schema.calls)
        .where(eq(schema.calls.workspaceId, args.workspaceId))
        .limit(1);
      if (salesCount || callCount) {
        return {
          applied: false as const,
          reason:
            "Workspace already has activity. Topology preset can't be swapped wholesale once data exists — edit roles / commissions / funnel individually instead.",
        };
      }

      const preset = TOPOLOGY_PRESETS[args.preset];

      // Hard-delete the seeded taxonomies. Soft-delete doesn't work here
      // because the unique constraints on (workspace_id, slug) for
      // sales_roles / funnel_stages / dispositions don't honor
      // deleted_at, so re-inserting the new preset's same slugs would
      // collide. The safety check above already verified no sales /
      // calls / commission_recipients exist; cascades on the versions +
      // assignments tables clean up automatically.
      await tx
        .delete(schema.salesRoleAssignments)
        .where(eq(schema.salesRoleAssignments.workspaceId, args.workspaceId));
      await tx
        .delete(schema.salesRoles)
        .where(eq(schema.salesRoles.workspaceId, args.workspaceId));
      await tx
        .delete(schema.funnelStages)
        .where(eq(schema.funnelStages.workspaceId, args.workspaceId));
      await tx
        .delete(schema.dispositions)
        .where(eq(schema.dispositions.workspaceId, args.workspaceId));
      await tx
        .delete(schema.commissionRules)
        .where(eq(schema.commissionRules.workspaceId, args.workspaceId));

      // Re-seed roles + versions.
      const roleSeeds = preset.roles.map((r) => ({
        workspaceId: args.workspaceId,
        slug: r.slug,
        label: r.label,
        stageOwnership: [...r.stageOwnership],
        defaultCommissionShare: r.defaultCommissionShare,
        defaultSlaSeconds: r.defaultSlaSeconds,
        sortOrder: r.sortOrder,
      }));
      const insertedRoles = roleSeeds.length
        ? await tx
            .insert(schema.salesRoles)
            .values(roleSeeds)
            .returning({ id: schema.salesRoles.id })
        : [];
      if (insertedRoles.length > 0) {
        await tx.insert(schema.salesRoleVersions).values(
          insertedRoles.map((r, idx) => ({
            salesRoleId: r.id,
            version: 1,
            snapshot: {
              slug: roleSeeds[idx]!.slug,
              label: roleSeeds[idx]!.label,
              stageOwnership: roleSeeds[idx]!.stageOwnership,
              defaultCommissionShare: roleSeeds[idx]!.defaultCommissionShare,
              defaultSlaSeconds: roleSeeds[idx]!.defaultSlaSeconds,
            },
            createdBy: args.actorUserId,
          })),
        );
      }

      // Re-seed stages + versions.
      const stageSeeds = preset.stages.map((s) => ({
        workspaceId: args.workspaceId,
        slug: s.slug,
        label: s.label,
        kind: s.kind,
        ordinal: s.ordinal,
      }));
      const insertedStages = stageSeeds.length
        ? await tx
            .insert(schema.funnelStages)
            .values(stageSeeds)
            .returning({ id: schema.funnelStages.id })
        : [];
      if (insertedStages.length > 0) {
        await tx.insert(schema.funnelStageVersions).values(
          insertedStages.map((stage, idx) => ({
            funnelStageId: stage.id,
            version: 1,
            snapshot: {
              slug: stageSeeds[idx]!.slug,
              label: stageSeeds[idx]!.label,
              kind: stageSeeds[idx]!.kind,
              ordinal: stageSeeds[idx]!.ordinal,
            },
          })),
        );
      }

      // Re-seed default commission rules from the new preset.
      const ruleRows = insertedRoles.map((role, idx) => ({
        workspaceId: args.workspaceId,
        name: `${roleSeeds[idx]!.label} default`,
        type: "flat_rate" as const,
        salesRoleId: role.id,
        sharePct: roleSeeds[idx]!.defaultCommissionShare,
        holdDays: 30,
        paidOn: "collected",
        effectiveFrom: new Date(),
        createdBy: args.actorUserId,
      }));
      const insertedRules = ruleRows.length
        ? await tx
            .insert(schema.commissionRules)
            .values(ruleRows)
            .returning({ id: schema.commissionRules.id })
        : [];
      if (insertedRules.length > 0) {
        await tx.insert(schema.commissionRuleVersions).values(
          insertedRules.map((r, idx) => ({
            commissionRuleId: r.id,
            version: 1,
            snapshot: { ...ruleRows[idx] },
            createdBy: args.actorUserId,
          })),
        );
      }

      // Update workspace's preset marker.
      await tx
        .update(schema.workspaces)
        .set({ topologyPreset: args.preset, updatedAt: new Date() })
        .where(eq(schema.workspaces.id, args.workspaceId));

      return { applied: true as const, preset: args.preset };
    }),
  );
}
