// Map a GHL appointment payload to the call fields RevOps cares about.
// Phase 1 keeps it minimal — id, contact info, appointmentAt, status →
// disposition mapping happens later (we just store the raw status in
// metadata.ghlStatus and let the user disposition manually for now).
//
// Custom-field mapping (the wide bit of the old app) is deferred to a
// followup; we preserve the raw payload in metadata.ghl so nothing is
// lost.

import { GHL_STATUS_MAP, type GhlEventType } from "./events";
import type { GhlAppointment, GhlContact } from "./types";

export type MappedCall = {
  externalId: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  appointmentAt: Date;
  ghlStatus: string;
  internalStatus: string;
  ghlContactId: string | null;
  ghlAssignedUserId: string | null;
  metadata: Record<string, unknown>;
};

export function mapAppointmentToCall(
  payload: { type: string; appointment: GhlAppointment; contact?: GhlContact },
): MappedCall {
  const a = payload.appointment;
  const c = payload.contact;
  const ghlStatus = (a.appointmentStatus ?? "new").toLowerCase();
  return {
    externalId: a.id,
    contactName: c
      ? [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || null
      : null,
    contactEmail: c?.email ?? null,
    contactPhone: c?.phone ?? null,
    appointmentAt: new Date(a.startTime),
    ghlStatus,
    internalStatus: GHL_STATUS_MAP[ghlStatus] ?? "scheduled",
    ghlContactId: a.contactId ?? null,
    ghlAssignedUserId: a.assignedUserId ?? null,
    metadata: {
      ghl: {
        appointment: a,
        eventType: payload.type as GhlEventType,
      },
    },
  };
}
