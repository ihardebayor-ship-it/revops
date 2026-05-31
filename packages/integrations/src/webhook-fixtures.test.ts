import { describe, expect, it } from "vitest";
import { aircallEndedFixture, aircallWebhookSchema } from "./aircall";
import { fathomRecordingCompletedFixture, fathomWebhookSchema } from "./fathom";
import { ghlAppointmentCreateFixture, ghlWebhookPayloadSchema } from "./ghl";

describe("provider webhook fixtures", () => {
  it("keeps the GHL fixture compatible with the webhook schema", () => {
    expect(ghlWebhookPayloadSchema.safeParse(ghlAppointmentCreateFixture).success).toBe(true);
  });

  it("keeps the Aircall fixture compatible with the webhook schema", () => {
    expect(aircallWebhookSchema.safeParse(aircallEndedFixture).success).toBe(true);
  });

  it("keeps the Fathom fixture compatible with the webhook schema", () => {
    expect(fathomWebhookSchema.safeParse(fathomRecordingCompletedFixture).success).toBe(true);
  });
});
