// Zod schemas for GHL webhook payloads. Shape ported from old app's
// ghl-appointment-webhook/index.ts lines 9-29.

import { z } from "zod";

export const ghlAppointmentSchema = z.object({
  id: z.string(),
  calendarId: z.string().optional(),
  contactId: z.string().optional(),
  groupId: z.string().optional(),
  appointmentStatus: z.string().optional(),
  assignedUserId: z.string().optional(),
  users: z.array(z.string()).optional(),
  notes: z.string().optional(),
  source: z.string().optional(),
  startTime: z.string(),
  endTime: z.string().optional(),
  title: z.string().optional(),
  address: z.string().optional(),
  dateAdded: z.string().optional(),
  dateUpdated: z.string().optional(),
});

export const ghlContactSchema = z.object({
  id: z.string(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  fullNameLowerCase: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  customFields: z
    .union([
      z.array(z.object({ id: z.string(), value: z.unknown() })),
      z.record(z.string(), z.unknown()),
    ])
    .optional(),
});

export const ghlWebhookPayloadSchema = z.object({
  type: z.string(),
  locationId: z.string().optional(),
  appointment: ghlAppointmentSchema.optional(),
  contact: ghlContactSchema.optional(),
});

export type GhlWebhookPayload = z.infer<typeof ghlWebhookPayloadSchema>;
export type GhlAppointment = z.infer<typeof ghlAppointmentSchema>;
export type GhlContact = z.infer<typeof ghlContactSchema>;
