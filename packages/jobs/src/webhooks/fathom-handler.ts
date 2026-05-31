// fathom.webhook.received → chunk transcript → embed → write agent_facts.
//
// Resolution: match the recording back to a customer using the calendar
// invitees' email addresses, constrained by the local workspace/sub-account
// key embedded in the webhook URL. No global email lookup is allowed.
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
import { and, eq } from "drizzle-orm";
import { bypassRls, schema, withTenant, type Db } from "@revops/db/client";
import { embedTexts } from "@revops/integrations/shared";
import {
  FATHOM_PROVIDER_ID,
  chunkTranscript,
  fathomWebhookSchema,
  flattenTranscript,
} from "@revops/integrations/fathom";
import { logger } from "@revops/observability";
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
      providerAccountId: schema.webhookInboundEvents.providerAccountId,
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
  const scope = parseFathomProviderAccountId(row.providerAccountId);
  if (!scope) {
    await markProcessed(db, row.id, "invalid_provider_account_id");
    logger.warn("webhook.process_skipped", {
      source: FATHOM_PROVIDER_ID,
      inboundEventId: row.id,
      providerAccountId: row.providerAccountId,
      reason: "invalid_provider_account_id",
    });
    return { skipped: true, reason: "invalid_provider_account_id" };
  }

  // Pick the first invitee email that maps to an existing customer.
  const invitees = (payload.calendar_invitees ?? []).filter((i) => !!i.email);
  if (invitees.length === 0) {
    await markProcessed(db, row.id, "no_invitees_with_email");
    logger.info("webhook.process_skipped", {
      source: FATHOM_PROVIDER_ID,
      inboundEventId: row.id,
      providerAccountId: row.providerAccountId,
      reason: "no_invitees_with_email",
    });
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
      .where(
        and(
          eq(schema.customers.primaryEmail, inv.email!.toLowerCase().trim()),
          scope.subAccountId
            ? eq(schema.customers.subAccountId, scope.subAccountId)
            : eq(schema.customers.workspaceId, scope.workspaceId!),
        ),
      )
      .limit(1);
    if (c) {
      resolved = { workspaceId: c.workspaceId, subAccountId: c.subAccountId, customerId: c.id };
      break;
    }
  }
  if (!resolved) {
    await markProcessed(db, row.id, "no_matching_customer");
    logger.info("webhook.process_skipped", {
      source: FATHOM_PROVIDER_ID,
      inboundEventId: row.id,
      providerAccountId: row.providerAccountId,
      reason: "no_matching_customer",
    });
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

  await withTenant(
    {
      userId: "webhook:fathom",
      workspaceId: resolved.workspaceId,
      subAccountId: resolved.subAccountId,
      accessRole: "sub_account_admin",
      isSuperadmin: false,
    },
    async (tenantDb) => {
      for (let i = 0; i < chunks.length; i++) {
        await tenantDb.insert(schema.agentFacts).values({
          workspaceId: resolved.workspaceId,
          scope: "customer",
          scopeRefId: resolved.customerId,
          kind: "fact",
          content: chunks[i]!,
          embedding: vectors[i]!,
          confidence: "0.70",
        });
      }
    },
  );

  await markProcessed(db, row.id, null);
  logger.info("webhook.processed", {
    source: FATHOM_PROVIDER_ID,
    inboundEventId: row.id,
    providerAccountId: row.providerAccountId,
    workspaceId: resolved.workspaceId,
    subAccountId: resolved.subAccountId,
    customerId: resolved.customerId,
    chunks: chunks.length,
    tokens: totalTokens,
  });
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

function parseFathomProviderAccountId(
  providerAccountId: string,
):
  | { workspaceId: string; subAccountId?: never }
  | { workspaceId?: never; subAccountId: string }
  | null {
  if (providerAccountId.startsWith("workspace:")) {
    const workspaceId = providerAccountId.slice("workspace:".length).trim();
    return workspaceId ? { workspaceId } : null;
  }
  if (providerAccountId.startsWith("subAccount:")) {
    const subAccountId = providerAccountId.slice("subAccount:".length).trim();
    return subAccountId ? { subAccountId } : null;
  }
  return null;
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
