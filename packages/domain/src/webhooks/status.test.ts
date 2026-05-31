import { describe, expect, it } from "vitest";
import { classifyInboundWebhookEvent } from "./index";

describe("classifyInboundWebhookEvent", () => {
  it("classifies unprocessed events as pending", () => {
    expect(classifyInboundWebhookEvent({ processedAt: null, error: null })).toBe("pending");
  });

  it("classifies processed events without errors as processed", () => {
    expect(classifyInboundWebhookEvent({ processedAt: new Date(), error: null })).toBe("processed");
  });

  it("classifies events with an error as failed", () => {
    expect(classifyInboundWebhookEvent({ processedAt: new Date(), error: "schema invalid" })).toBe(
      "failed",
    );
  });
});
