// fathom.webhook.received → chunk transcript → embed → write agent_facts.
//
// Resolution: match the recording back to a call using the calendar
// invitees' email addresses. We pick the first invitee whose email
// matches an existing customer in any of our workspaces' sub_accounts.
// Phase 1 keeps this deterministic — no fuzzy matching here yet (the
// existing reconciliation scorer can be wired later if false negatives
// appear in production).
//
// agent_facts inserts:
//   workspace_id    → resolved workspace
//   scope='customer', scopeRefId=customer.id
//   kind='fact'
//   content         → the chunk text
//   embedding       → 1536-dim vector from text-embedding-3-small
//   confidence      → 0.7 default
//   sourceMessageId → null (transcript origin tracked via metadata.sourceFathomId)

import { NonRetriableError } from "inngest";
import { eq } from "drizzle-orm";
import { bypassRls, schema, type Db } from "@revops/db/client";
import { embedTexts } from "@revops/integrations/shared";
import {
  FATHOM_PROVIDER_ID,
  chunkTranscript,
  fathomWebhookSchema,
  flattenTranscript,
} from "@revops/integrations/fathom";
import { inngest } from "../client";

export type FathomProcessResult =
  | { skipped: true; reason: string }
  | { skipped: false; customerId: string; chunks: number; tokens: number };

export async function processFathomInboundEvent(
  db: Db,
  inboundEventId: string,
): Promise<FathomProcessResult> {
  const [row] = await db
    .select({
      id: schema.webhookInboundEvents.id,
      payload: schema.webhookInboundEvents.payload,
      processedAt: schema.webhookInboundEvents.processedAt,
    })
    .from(schema.webhookInboundEvents)
    .where(eq(schema.webhookInboundEvents.id, inboundEventId))
    .limit(1);
  if (!row) throw new NonRetriableError(`Inbound event ${inboundEventId} not found`);
  if (row.processedAt) return { skipped: true, reason: "already_processed" };

  const parsed = fathomWebhookSchema.safeParse(row.payload);
  if (!parsed.success) {
    await markProcessed(db, row.id, `Schema invalid: ${parsed.error.message}`);
    throw new NonRetriableError(`Payload invalid: ${parsed.error.message}`);
  }
  const payload = parsed.data;

  // Pick the first invitee email that maps to an existing customer.
  const invitees = (payload.calendar_invitees ?? []).filter((i) => !!i.email);
  if (invitees.length === 0) {
    await markProcessed(db, row.id, "no_invitees_with_email");
    return { skipped: true, reason: "no_invitees_with_email" };
  }

  let resolved: { workspaceId: string; subAccountId: string; customerId: string } | null = null;
  for (const inv of invitees) {
    const [c] = await db
      .select({
        id: schema.customers.id,
        workspaceId: schema.customers.workspaceId,
        subAccountId: schema.customers.subAccountId,
      })
      .from(schema.customers)
      .where(eq(schema.customers.primaryEmail, inv.email!.toLowerCase().trim()))
      .limit(1);
    if (c) {
      resolved = { workspaceId: c.workspaceId, subAccountId: c.subAccountId, customerId: c.id };
      break;
    }
  }
  if (!resolved) {
    await markProcessed(db, row.id, "no_matching_customer");
    return { skipped: true, reason: "no_matching_customer" };
  }

  // Build the text and chunk.
  const flat = flattenTranscript(payload.transcript);
  const summary = payload.default_summary?.markdown_formatted ?? "";
  const blob = [summary, flat].filter(Boolean).join("\n\n");
  const chunks = chunkTranscript(blob);
  if (chunks.length === 0) {
    await markProcessed(db, row.id, "no_chunks_after_chunking");
    return { skipped: true, reason: "no_chunks" };
  }

  const { vectors, totalTokens } = await embedTexts(chunks);
  if (vectors.length !== chunks.length) {
    await markProcessed(db, row.id, "embedding_count_mismatch");
    throw new Error("Embedding count != chunk count");
  }

  for (let i = 0; i < chunks.length; i++) {
    await db.insert(schema.agentFacts).values({
      workspaceId: resolved.workspaceId,
      scope: "customer",
      scopeRefId: resolved.customerId,
      kind: "fact",
      content: chunks[i]!,
      embedding: vectors[i]!,
      confidence: "0.70",
    });
  }

  await markProcessed(db, row.id, null);
  return {
    skipped: false,
    customerId: resolved.customerId,
    chunks: chunks.length,
    tokens: totalTokens,
  };
}

async function markProcessed(db: Db, id: string, error: string | null): Promise<void> {
  await db
    .update(schema.webhookInboundEvents)
    .set({ processedAt: new Date(), error })
    .where(eq(schema.webhookInboundEvents.id, id));
}

export const fathomWebhookHandler = inngest.createFunction(
  {
    id: "fathom-webhook-handler",
    concurrency: { limit: 5 }, // OpenAI embeddings rate cap is generous; cap us anyway
    retries: 2,
  },
  { event: "fathom.webhook.received" },
  async ({ event, step }) => {
    const { inboundEventId } = event.data;
    return step
      .run("process", () => bypassRls((db) => processFathomInboundEvent(db, inboundEventId)))
      .catch((err) => {
        if (err instanceof NonRetriableError) throw err;
        throw new Error(
          `Fathom webhook handler failed: ${err instanceof Error ? err.message : err}`,
        );
      });
  },
);

void FATHOM_PROVIDER_ID;
