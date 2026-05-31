import type { AircallWebhookPayload } from "./types";

export const aircallEndedFixture = {
  event: "call.ended",
  resource: "call",
  timestamp: 1_767_000_090,
  data: {
    id: "aircall-call-1",
    started_at: 1_767_000_000,
    ended_at: 1_767_000_090,
    duration: 90,
    direction: "outbound",
    user: { id: "aircall-user-1", email: "rep@example.test" },
    contact: {
      id: "aircall-contact-1",
      email: "buyer@example.test",
      phone_number: "+15555550100",
      first_name: "Buyer",
      last_name: "Example",
    },
  },
} satisfies AircallWebhookPayload;

export const aircallEndedMissingUserFixture = {
  ...aircallEndedFixture,
  data: {
    ...aircallEndedFixture.data,
    user: null,
  },
} satisfies AircallWebhookPayload;
