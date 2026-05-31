export type InboundWebhookEventStatus = "pending" | "processed" | "failed";

export type InboundWebhookEventStatusInput = {
  processedAt?: Date | null;
  error?: string | null;
};

export function classifyInboundWebhookEvent(
  event: InboundWebhookEventStatusInput,
): InboundWebhookEventStatus {
  if (event.error) return "failed";
  if (event.processedAt) return "processed";
  return "pending";
}
