// Fathom — recording + transcript ingest. M5.3 wires the webhook into a
// chunk → embed → agent_facts pipeline so the agent can RAG against past
// conversations.

export const FATHOM_PROVIDER_ID = "fathom" as const;

export {
  fathomWebhookSchema,
  fathomInviteeSchema,
  fathomTranscriptItemSchema,
  type FathomWebhookPayload,
  type FathomInvitee,
} from "./types";
export { verifyFathomSignature } from "./signature";
export {
  chunkTranscript,
  flattenTranscript,
  MAX_CHUNK_SIZE,
  MIN_CHUNK_SIZE,
} from "./chunk";
