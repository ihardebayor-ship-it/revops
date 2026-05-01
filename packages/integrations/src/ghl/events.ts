// GHL webhook event names we care about. Anything else is acked but ignored.
export const GHL_SUPPORTED_EVENTS = [
  "AppointmentCreate",
  "AppointmentUpdate",
  "ContactCreate",
  "ContactUpdate",
] as const;

export type GhlEventType = (typeof GHL_SUPPORTED_EVENTS)[number];

// Status map ported verbatim from old app (ghl-appointment-webhook line 616).
// Maps GHL appointmentStatus → our internal call status.
export const GHL_STATUS_MAP: Record<string, string> = {
  confirmed: "scheduled",
  showed: "showed",
  noshow: "no_sale",
  cancelled: "canceled_by_customer",
  invalid: "canceled_by_customer",
  new: "scheduled",
};

// OAuth scopes — copied from old app's get-ghl-auth-url lines 131-152.
export const GHL_OAUTH_SCOPES = [
  "calendars.readonly",
  "calendars/events.readonly",
  "calendars/events.write",
  "contacts.readonly",
  "contacts.write",
  "users.readonly",
  "locations.readonly",
  "opportunities.readonly",
  "conversations.readonly",
].join(" ");

export const GHL_TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;
