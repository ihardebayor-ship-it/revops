import type { FathomWebhookPayload } from "./types";

export const fathomRecordingCompletedFixture = {
  event: "recording.completed",
  recording_id: "recording-1",
  title: "Buyer discovery call",
  recording_start_time: "2026-01-02T10:00:00.000Z",
  duration_minutes: 30,
  calendar_invitees: [
    {
      name: "Buyer Example",
      email: "buyer@example.test",
      email_domain: "example.test",
      is_external: true,
    },
  ],
  transcript: "The buyer wants implementation next week. ".repeat(8),
  default_summary: {
    template_name: "default",
    markdown_formatted: "Buyer is evaluating RevOps process automation.",
  },
} satisfies FathomWebhookPayload;

export const fathomRecordingMissingInviteesFixture = {
  ...fathomRecordingCompletedFixture,
  calendar_invitees: [],
} satisfies FathomWebhookPayload;
