// Fathom webhook payload. Shape ported from old app's
// fathom-recording-webhook/index.ts lines 9-60.

import { z } from "zod";

export const fathomTranscriptItemSchema = z.union([
  z.object({
    speaker: z
      .object({
        display_name: z.string().optional(),
      })
      .optional(),
    text: z.string().optional(),
    timestamp: z.string().optional(),
  }),
  z.string(),
]);

export const fathomInviteeSchema = z.object({
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  email_domain: z.string().nullable().optional(),
  is_external: z.boolean().optional(),
  matched_speaker_display_name: z.string().nullable().optional(),
});

export const fathomWebhookSchema = z.object({
  event: z.string().optional(),
  recording_id: z.union([z.string(), z.number()]),
  title: z.string().nullable().optional(),
  meeting_title: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  share_url: z.string().nullable().optional(),
  recording_url: z.string().nullable().optional(),
  recording_start_time: z.string().nullable().optional(),
  recording_end_time: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  duration_minutes: z.number().nullable().optional(),
  calendar_invitees: z.array(fathomInviteeSchema).optional(),
  transcript: z.union([z.array(fathomTranscriptItemSchema), z.string()]).optional(),
  default_summary: z
    .object({
      template_name: z.string().nullable().optional(),
      markdown_formatted: z.string().nullable().optional(),
    })
    .optional(),
});

export type FathomWebhookPayload = z.infer<typeof fathomWebhookSchema>;
export type FathomInvitee = z.infer<typeof fathomInviteeSchema>;
