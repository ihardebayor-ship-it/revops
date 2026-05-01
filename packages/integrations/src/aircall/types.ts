// Aircall webhook payload shapes. Aircall fires per-event webhooks shaped:
//   { event: "call.ended", resource: "call", timestamp: number, data: {...} }
// We normalize to a discriminated union over the 3 events we handle in M5.

import { z } from "zod";

export const aircallContactSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  email: z.string().optional(),
  phone_number: z.string().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
});

export const aircallCallDataSchema = z.object({
  id: z.union([z.string(), z.number()]),
  direct_link: z.string().optional(),
  direction: z.enum(["inbound", "outbound"]).optional(),
  status: z.string().optional(),
  duration: z.number().optional(),
  started_at: z.number().optional(),
  answered_at: z.number().nullable().optional(),
  ended_at: z.number().nullable().optional(),
  raw_digits: z.string().optional(),
  recording: z.string().nullable().optional(),
  voicemail: z.string().nullable().optional(),
  contact: aircallContactSchema.nullable().optional(),
  user: z
    .object({
      id: z.union([z.string(), z.number()]).optional(),
      email: z.string().optional(),
    })
    .nullable()
    .optional(),
});

export const aircallWebhookSchema = z.object({
  event: z.string(),
  resource: z.string().optional(),
  timestamp: z.number().optional(),
  token: z.string().optional(),
  data: aircallCallDataSchema,
});

export type AircallWebhookPayload = z.infer<typeof aircallWebhookSchema>;
export type AircallCallData = z.infer<typeof aircallCallDataSchema>;
