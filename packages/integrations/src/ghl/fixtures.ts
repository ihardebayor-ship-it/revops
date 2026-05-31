import type { GhlWebhookPayload } from "./types";

export const ghlAppointmentCreateFixture = {
  type: "AppointmentCreate",
  locationId: "loc-1",
  appointment: {
    id: "appointment-1",
    startTime: "2026-01-02T10:00:00.000Z",
    appointmentStatus: "confirmed",
    contactId: "contact-1",
  },
  contact: {
    id: "contact-1",
    firstName: "Buyer",
    lastName: "Example",
    email: "buyer@example.test",
    phone: "+15555550100",
  },
} satisfies GhlWebhookPayload;

export const ghlAppointmentMissingLocationFixture = {
  ...ghlAppointmentCreateFixture,
  locationId: undefined,
} satisfies GhlWebhookPayload;
