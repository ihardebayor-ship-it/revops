// Map Aircall webhook payload → call upsert fields. We don't try to be
// clever here: phone-number is the only stable join key (Aircall doesn't
// know our internal call ids). Handler later resolves the workspace via
// data_source_connections matched by externalAccountId = aircall.user.id
// or by the contact's phone within a sub_account window.

import type { AircallCallData } from "./types";

export type MappedAircallCall = {
  externalId: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  appointmentAt: Date;
  durationSeconds: number | null;
  recordingUrl: string | null;
  direction: string | null;
  metadata: Record<string, unknown>;
};

export function mapAircallCall(eventName: string, d: AircallCallData): MappedAircallCall {
  const startedMs = d.started_at ? d.started_at * 1000 : Date.now();
  const contactName =
    d.contact && [d.contact.first_name, d.contact.last_name].filter(Boolean).join(" ").trim();
  return {
    externalId: String(d.id),
    contactName: contactName || null,
    contactEmail: d.contact?.email ?? null,
    contactPhone: d.contact?.phone_number ?? d.raw_digits ?? null,
    appointmentAt: new Date(startedMs),
    durationSeconds: d.duration ?? null,
    recordingUrl: d.recording ?? null,
    direction: d.direction ?? null,
    metadata: {
      aircall: {
        event: eventName,
        callId: d.id,
        directLink: d.direct_link,
        status: d.status,
        userId: d.user?.id,
        endedAt: d.ended_at,
      },
    },
  };
}
