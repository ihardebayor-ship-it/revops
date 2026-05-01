// GHL — GoHighLevel integration. Phase 1 M5.

export const GHL_PROVIDER_ID = "gohighlevel" as const;

export {
  GHL_SUPPORTED_EVENTS,
  GHL_STATUS_MAP,
  GHL_OAUTH_SCOPES,
  GHL_TOKEN_EXPIRY_BUFFER_MS,
  type GhlEventType,
} from "./events";
export {
  ghlWebhookPayloadSchema,
  ghlAppointmentSchema,
  ghlContactSchema,
  type GhlWebhookPayload,
  type GhlAppointment,
  type GhlContact,
} from "./types";
export { verifyGhlSignature } from "./signature";
export {
  buildInstallUrl,
  decodeInstallState,
  exchangeCodeForTokens,
  refreshAccessToken,
  type GhlInstallState,
  type GhlTokenExchangeResult,
} from "./oauth";
export { createGhlClient, GHL_API_BASE, type GhlClient } from "./client";
export { mapAppointmentToCall, type MappedCall } from "./field-mapping";
