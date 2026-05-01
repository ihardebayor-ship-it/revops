// Aircall — Phase 1 M5. API-key auth (no OAuth). Auto-logs calls from the
// dialer, populates duration + recording on call.ended.

export const AIRCALL_PROVIDER_ID = "aircall" as const;

export {
  AIRCALL_SUPPORTED_EVENTS,
  AIRCALL_API_BASE,
  type AircallEvent,
} from "./events";
export {
  aircallWebhookSchema,
  aircallCallDataSchema,
  type AircallWebhookPayload,
  type AircallCallData,
} from "./types";
export { verifyAircallToken } from "./signature";
export { aircallPing, createAircallClient, type AircallCredentials, type AircallClient } from "./client";
export { mapAircallCall, type MappedAircallCall } from "./field-mapping";
