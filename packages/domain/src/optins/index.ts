// Optins domain — inbound leads. Auto-attribution distributes new optins to
// setters via round-robin within the active sales_role_assignments for the
// "setter" role in the given sub_account.
//
// Phase 1 M2 ships:
//   - createOptin(...)         → insert + optional auto-attribute
//   - listOptins(...)          → setter dashboard / inbox
//   - runSpeedToLeadSweep(...) → core sweep body, called from cron + test

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";
import { emitFunnelEvent } from "../funnel/emit";
import { upsertTaskByUniqueKey } from "../tasks/index";

export type CreateOptinInput = {
  workspaceId: string;
  subAccountId: string;
  email: string;
  name?: string | null;
  phone?: string | null;
  leadSource?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  formResponse?: Record<string, unknown>;
  sourceIntegration?: string | null;
  externalId?: string | null;
  submittedAt: Date;
  /** When true, round-robins the optin to the setter with the fewest open
   *  speed-to-lead tasks. Defaults true. */
  attribute?: boolean;
  createdBy?: string | null;
};

async function pickSetter(db: Db, subAccountId: string): Promise<string | null> {
  // Find users assigned the "setter" sales-role for this sub-account, ranked
  // by open speed-to-lead task count ascending (tiebreaker: random). Phase 2
  // gets a more sophisticated weighted strategy; M2 round-robin-by-load is
  // good enough.
  const rows = await db.execute(sql`
    SELECT a.user_id, COALESCE(t.n, 0)::int AS open_count
    FROM sales_role_assignments a
    JOIN sales_roles r ON r.id = a.sales_role_id AND r.slug = 'setter'
    LEFT JOIN (
      SELECT assigned_user_id, count(*) AS n
      FROM tasks
      WHERE sub_account_id = ${subAccountId}
        AND status = 'open'
        AND kind = 'follow_up_due'
      GROUP BY assigned_user_id
    ) t ON t.assigned_user_id = a.user_id
    WHERE a.sub_account_id = ${subAccountId}
      AND a.deleted_at IS NULL
      AND (a.effective_to IS NULL OR a.effective_to > now())
    ORDER BY open_count ASC, random()
    LIMIT 1
  `);
  const candidate = rows[0] as { user_id?: string } | undefined;
  return candidate?.user_id ?? null;
}

export async function createOptin(db: Db, input: CreateOptinInput) {
  return db.transaction(async (tx) => {
    const attribute = input.attribute ?? true;
    const setterUserId = attribute ? await pickSetter(tx, input.subAccountId) : null;

    const [row] = await tx
      .insert(schema.optins)
      .values({
        workspaceId: input.workspaceId,
        subAccountId: input.subAccountId,
        email: input.email,
        name: input.name ?? null,
        phone: input.phone ?? null,
        leadSource: input.leadSource ?? null,
        utmSource: input.utmSource ?? null,
        utmMedium: input.utmMedium ?? null,
        utmCampaign: input.utmCampaign ?? null,
        formResponse: input.formResponse ?? {},
        sourceIntegration: input.sourceIntegration ?? null,
        externalId: input.externalId ?? null,
        submittedAt: input.submittedAt,
        attributedSetterUserId: setterUserId,
        createdBy: input.createdBy ?? null,
      })
      .returning({ id: schema.optins.id });
    if (!row) throw new Error("Failed to create optin");

    // Emit "optin" stage event so analytics has the lead origin event in
    // the funnel stream.
    await emitFunnelEvent(tx, {
      workspaceId: input.workspaceId,
      subAccountId: input.subAccountId,
      entityType: "optin",
      entityId: row.id,
      stageSlug: "optin",
      occurredAt: input.submittedAt,
      meta: { source: input.sourceIntegration ?? "manual" },
    });

    return { id: row.id, attributedSetterUserId: setterUserId };
  });
}

export type ListOptinsFilter = {
  subAccountId: string;
  attributedToUserId?: string | null;
  pendingOnly?: boolean;
  limit?: number;
};

export async function listOptins(db: Db, filter: ListOptinsFilter) {
  const limit = Math.min(filter.limit ?? 50, 200);
  const conditions = [eq(schema.optins.subAccountId, filter.subAccountId)];
  if (filter.attributedToUserId) {
    conditions.push(eq(schema.optins.attributedSetterUserId, filter.attributedToUserId));
  }
  if (filter.pendingOnly) {
    conditions.push(isNull(schema.optins.contactedCallId));
  }
  return db
    .select({
      id: schema.optins.id,
      email: schema.optins.email,
      name: schema.optins.name,
      phone: schema.optins.phone,
      submittedAt: schema.optins.submittedAt,
      contactedAt: schema.optins.contactedAt,
      contactedCallId: schema.optins.contactedCallId,
      attributedSetterUserId: schema.optins.attributedSetterUserId,
      leadSource: schema.optins.leadSource,
    })
    .from(schema.optins)
    .where(and(...conditions))
    .orderBy(desc(schema.optins.submittedAt))
    .limit(limit);
}

void asc;

/**
 * Speed-to-lead SLA sweep body. Finds optins past their workspace SLA
 * window without contact and upserts a follow_up_due task assigned to the
 * attributed setter. Idempotent via tasks.unique_key=`speed_to_lead:{id}`.
 *
 * Called by the Inngest cron in @revops/jobs and by the dev-only test
 * endpoint /api/test/sla-sweep.
 */
export async function runSpeedToLeadSweep(db: Db): Promise<{ scanned: number; upserted: number }> {
  const candidates = await db.execute(sql`
    SELECT
      o.id              AS optin_id,
      o.workspace_id,
      o.sub_account_id,
      o.email,
      o.name,
      o.attributed_setter_user_id AS setter_id,
      o.submitted_at,
      ws.speed_to_lead_sla_seconds AS sla_seconds,
      sr.id             AS setter_role_id
    FROM optins o
    JOIN workspace_settings ws ON ws.workspace_id = o.workspace_id
    LEFT JOIN sales_roles sr
      ON sr.workspace_id = o.workspace_id AND sr.slug = 'setter'
    WHERE o.contacted_call_id IS NULL
      AND o.attributed_setter_user_id IS NOT NULL
      AND o.submitted_at + (CAST(ws.speed_to_lead_sla_seconds AS int) * INTERVAL '1 second') < now()
    LIMIT 200
  `);
  const rows = candidates as Array<Record<string, unknown>>;
  let upserted = 0;
  for (const row of rows) {
    const optinId = String(row.optin_id);
    const setterId = row.setter_id ? String(row.setter_id) : null;
    if (!setterId) continue;
    const res = await upsertTaskByUniqueKey(db, {
      workspaceId: String(row.workspace_id),
      subAccountId: String(row.sub_account_id),
      kind: "follow_up_due",
      title: `Speed-to-lead: contact ${row.name || row.email}`,
      description: `New opt-in past SLA. Contact ${row.email} now.`,
      payload: { optinId, email: String(row.email ?? ""), name: row.name ? String(row.name) : null },
      assignedUserId: setterId,
      salesRoleId: row.setter_role_id ? String(row.setter_role_id) : null,
      relatedEntityType: "optin",
      relatedEntityId: optinId,
      dueAt: new Date(),
      uniqueKey: `speed_to_lead:${optinId}`,
    });
    if (res.inserted) upserted++;
  }
  return { scanned: rows.length, upserted };
}
