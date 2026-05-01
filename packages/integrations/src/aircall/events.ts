// Aircall events handled by M5. Anything else is recorded but ignored.
export const AIRCALL_SUPPORTED_EVENTS = [
  "call.created",
  "call.ended",
  "call.commented",
] as const;

export type AircallEvent = (typeof AIRCALL_SUPPORTED_EVENTS)[number];

export const AIRCALL_API_BASE = "https://api.aircall.io/v1";
