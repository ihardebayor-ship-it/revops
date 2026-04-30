import { randomBytes } from "node:crypto";
import { bypassRls, schema } from "@revops/db/client";
import { TOPOLOGY_PRESETS, type TopologyPresetSlug } from "./topology-presets";

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
