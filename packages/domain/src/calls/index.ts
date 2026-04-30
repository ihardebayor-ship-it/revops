// Calls domain — the rep's primary unit of work.
//
// Every mutation that represents a status transition emits a funnel_event
// via domain.funnel.emitFunnelEvent — the single source of truth for funnel
// state. Idempotent under replay.
//
// Disposition.category → funnel-stage emit mapping (M2 baseline):
//   won            → "closed"
//   positive/booked → no extra stage (already at booked when disposition set)
//   no_show        → no event (the absence of `showed_at` is the signal)
//   objection / disqualification / rescheduled → no event
// Phase 1 M3 will add fine-grained mapping when sales link.

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { type Db, schema } from "@revops/db/client";
import { emitFunnelEvent } from "../funnel/emit";

export type CreateCallInput = {
  workspaceId: string;
  subAccountId: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  appointmentAt?: Date | null;
  setterUserId?: string | null;
  closerUserId?: string | null;
  notes?: string | null;
  recordingConsent?: "one_party" | "two_party" | "unknown" | "declined";
  sourceIntegration?: string | null;
  externalId?: string | null;
  createdBy: string;
};

export async function createCall(db: Db, input: CreateCallInput) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.calls)
      .values({
        workspaceId: input.workspaceId,
        subAccountId: input.subAccountId,
        contactName: input.contactName ?? null,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        appointmentAt: input.appointmentAt ?? null,
        setterUserId: input.setterUserId ?? null,
        closerUserId: input.closerUserId ?? null,
        notes: input.notes ?? null,
        recordingConsent: input.recordingConsent ?? "unknown",
        sourceIntegration: input.sourceIntegration ?? null,
        externalId: input.externalId ?? null,
        createdBy: input.createdBy,
      })
      .returning({ id: schema.calls.id });
    if (!row) throw new Error("Failed to create call");

    if (input.appointmentAt) {
      // Emitting "booked" makes funnel analytics (booked-to-showed conversion,
      // etc.) work without anyone manually emitting events from the UI.
      await emitFunnelEvent(tx, {
        workspaceId: input.workspaceId,
        subAccountId: input.subAccountId,
        entityType: "call",
        entityId: row.id,
        stageSlug: "booked",
        occurredAt: new Date(),
        actorUserId: input.createdBy,
        meta: { kind: "call_booked" },
      });
    }

    return { id: row.id };
  });
}

export type UpdateCallInput = {
  callId: string;
  workspaceId: string;
  patch: {
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    appointmentAt?: Date | null;
    setterUserId?: string | null;
    closerUserId?: string | null;
    notes?: string | null;
    recordingConsent?: "one_party" | "two_party" | "unknown" | "declined";
  };
};

export async function updateCall(db: Db, input: UpdateCallInput) {
  const [row] = await db
    .update(schema.calls)
    .set({ ...input.patch, updatedAt: new Date() })
    .where(
      and(
        eq(schema.calls.id, input.callId),
        eq(schema.calls.workspaceId, input.workspaceId),
        isNull(schema.calls.deletedAt),
      ),
    )
    .returning({ id: schema.calls.id });
  if (!row) throw new Error("Call not found");
  return { id: row.id };
}

export type SetDispositionInput = {
  callId: string;
  workspaceId: string;
  subAccountId: string;
  dispositionId: string;
  actorUserId: string;
};

export async function setDisposition(db: Db, input: SetDispositionInput) {
  return db.transaction(async (tx) => {
    const [disp] = await tx
      .select({ category: schema.dispositions.category, slug: schema.dispositions.slug })
      .from(schema.dispositions)
      .where(
        and(
          eq(schema.dispositions.id, input.dispositionId),
          eq(schema.dispositions.workspaceId, input.workspaceId),
        ),
      )
      .limit(1);
    if (!disp) throw new Error("Disposition not found");

    const [updated] = await tx
      .update(schema.calls)
      .set({ dispositionId: input.dispositionId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.calls.id, input.callId),
          eq(schema.calls.workspaceId, input.workspaceId),
          isNull(schema.calls.deletedAt),
        ),
      )
      .returning({ id: schema.calls.id });
    if (!updated) throw new Error("Call not found");

    // Stage emit for terminal dispositions only. Other categories record the
    // disposition on the call without firing a funnel event.
    if (disp.category === "won") {
      await emitFunnelEvent(tx, {
        workspaceId: input.workspaceId,
        subAccountId: input.subAccountId,
        entityType: "call",
        entityId: input.callId,
        stageSlug: "closed",
        occurredAt: new Date(),
        actorUserId: input.actorUserId,
        meta: { dispositionSlug: disp.slug },
      });
    }

    return { id: input.callId, dispositionCategory: disp.category };
  });
}

export type SetOutcomeInput = {
  callId: string;
  workspaceId: string;
  subAccountId: string;
  showedAt?: Date | null;
  pitchedAt?: Date | null;
  completedAt?: Date | null;
  durationSeconds?: number | null;
  actorUserId: string;
};

export async function setOutcome(db: Db, input: SetOutcomeInput) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: schema.calls.id,
        showedAt: schema.calls.showedAt,
        pitchedAt: schema.calls.pitchedAt,
      })
      .from(schema.calls)
      .where(
        and(
          eq(schema.calls.id, input.callId),
          eq(schema.calls.workspaceId, input.workspaceId),
          isNull(schema.calls.deletedAt),
        ),
      )
      .limit(1);
    if (!current) throw new Error("Call not found");

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.showedAt !== undefined) patch.showedAt = input.showedAt;
    if (input.pitchedAt !== undefined) patch.pitchedAt = input.pitchedAt;
    if (input.completedAt !== undefined) patch.completedAt = input.completedAt;
    if (input.durationSeconds !== undefined) patch.durationSeconds = input.durationSeconds;
    await tx.update(schema.calls).set(patch).where(eq(schema.calls.id, input.callId));

    // Emit "showed" if this is the first time we're recording it. The
    // funnel/emit dedup makes a no-op if it was already emitted.
    if (input.showedAt && !current.showedAt) {
      await emitFunnelEvent(tx, {
        workspaceId: input.workspaceId,
        subAccountId: input.subAccountId,
        entityType: "call",
        entityId: input.callId,
        stageSlug: "showed",
        occurredAt: input.showedAt,
        actorUserId: input.actorUserId,
      });
    }
    if (input.pitchedAt && !current.pitchedAt) {
      // "pitched" stage exists in setter_closer / setter_closer_cx presets
      // but not in solo. emitFunnelEvent throws if the slug is missing —
      // catch and skip, since solo workspaces simply don't track pitch.
      try {
        await emitFunnelEvent(tx, {
          workspaceId: input.workspaceId,
          subAccountId: input.subAccountId,
          entityType: "call",
          entityId: input.callId,
          stageSlug: "pitched",
          occurredAt: input.pitchedAt,
          actorUserId: input.actorUserId,
        });
      } catch (err) {
        if (!(err instanceof Error && err.message.includes("does not exist"))) throw err;
      }
    }

    return { id: input.callId };
  });
}

export type LinkOptinInput = {
  callId: string;
  optinId: string;
  workspaceId: string;
  subAccountId: string;
  actorUserId: string;
};

/**
 * Mark an optin as contacted by linking it to a call. Emits the
 * "contacted" funnel event on the optin, populating the speed-to-lead
 * metric (time from optin.submittedAt → contacted_at).
 */
export async function linkOptin(db: Db, input: LinkOptinInput) {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [updated] = await tx
      .update(schema.optins)
      .set({ contactedCallId: input.callId, contactedAt: now })
      .where(
        and(
          eq(schema.optins.id, input.optinId),
          eq(schema.optins.workspaceId, input.workspaceId),
          isNull(schema.optins.contactedCallId),
        ),
      )
      .returning({ id: schema.optins.id });
    if (!updated) throw new Error("Optin not found or already contacted");

    await emitFunnelEvent(tx, {
      workspaceId: input.workspaceId,
      subAccountId: input.subAccountId,
      entityType: "optin",
      entityId: input.optinId,
      stageSlug: "contacted",
      occurredAt: now,
      actorUserId: input.actorUserId,
      meta: { contactedViaCallId: input.callId },
    });

    return { optinId: input.optinId, contactedAt: now };
  });
}

export async function softDeleteCall(
  db: Db,
  args: { callId: string; workspaceId: string },
) {
  const [row] = await db
    .update(schema.calls)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.calls.id, args.callId),
        eq(schema.calls.workspaceId, args.workspaceId),
        isNull(schema.calls.deletedAt),
      ),
    )
    .returning({ id: schema.calls.id });
  return { deleted: !!row };
}

export type ListCallsFilter = {
  subAccountId: string;
  setterUserId?: string | null;
  closerUserId?: string | null;
  contactEmail?: string | null;
  limit?: number;
};

export async function listCalls(db: Db, filter: ListCallsFilter) {
  const limit = Math.min(filter.limit ?? 50, 200);
  const conditions = [
    eq(schema.calls.subAccountId, filter.subAccountId),
    isNull(schema.calls.deletedAt),
  ];
  if (filter.setterUserId) conditions.push(eq(schema.calls.setterUserId, filter.setterUserId));
  if (filter.closerUserId) conditions.push(eq(schema.calls.closerUserId, filter.closerUserId));
  if (filter.contactEmail) conditions.push(eq(schema.calls.contactEmail, filter.contactEmail));

  return db
    .select({
      id: schema.calls.id,
      contactName: schema.calls.contactName,
      contactEmail: schema.calls.contactEmail,
      contactPhone: schema.calls.contactPhone,
      appointmentAt: schema.calls.appointmentAt,
      contactedAt: schema.calls.contactedAt,
      showedAt: schema.calls.showedAt,
      pitchedAt: schema.calls.pitchedAt,
      completedAt: schema.calls.completedAt,
      durationSeconds: schema.calls.durationSeconds,
      dispositionId: schema.calls.dispositionId,
      setterUserId: schema.calls.setterUserId,
      closerUserId: schema.calls.closerUserId,
      createdAt: schema.calls.createdAt,
    })
    .from(schema.calls)
    .where(and(...conditions))
    .orderBy(desc(schema.calls.appointmentAt), desc(schema.calls.createdAt))
    .limit(limit);
}

export async function getCall(db: Db, args: { callId: string; workspaceId: string }) {
  const [row] = await db
    .select()
    .from(schema.calls)
    .where(
      and(
        eq(schema.calls.id, args.callId),
        eq(schema.calls.workspaceId, args.workspaceId),
        isNull(schema.calls.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

// Suppress unused-import warning for asc — reserved for future sort variants.
void asc;
