import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNotNull, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { webhooks as webhookDomain } from "@revops/domain";
import { bypassRls, schema, type Db } from "@revops/db/client";
import { inngest } from "@revops/jobs";
import { router, authedProcedureWith } from "../server";

const webhookSourceSchema = z.enum(["gohighlevel", "aircall", "fathom"]);
const webhookStatusSchema = z.enum(["pending", "processed", "failed"]);

type ProviderAccountPair = {
  source: string;
  providerAccountId: string;
};

export const webhooksRouter = router({
  listInbound: authedProcedureWith("integration:connect")
    .input(
      z
        .object({
          source: webhookSourceSchema.optional(),
          status: webhookStatusSchema.optional(),
          limit: z.number().int().min(1).max(100).default(50),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });

      return bypassRls(async (db) => {
        const providerPairs = await listAllowedProviderAccounts(db, {
          workspaceId: ctx.user.workspaceId!,
          subAccountId: ctx.user.subAccountId,
          source: input.source,
        });
        const providerCondition = buildProviderCondition(providerPairs);
        if (!providerCondition) return [];

        const filters = [providerCondition];
        const statusCondition = buildStatusCondition(input.status);
        if (statusCondition) filters.push(statusCondition);

        const rows = await db
          .select({
            id: schema.webhookInboundEvents.id,
            source: schema.webhookInboundEvents.source,
            providerAccountId: schema.webhookInboundEvents.providerAccountId,
            externalId: schema.webhookInboundEvents.externalId,
            receivedAt: schema.webhookInboundEvents.receivedAt,
            signatureVerified: schema.webhookInboundEvents.signatureVerified,
            processedAt: schema.webhookInboundEvents.processedAt,
            error: schema.webhookInboundEvents.error,
          })
          .from(schema.webhookInboundEvents)
          .where(and(...filters))
          .orderBy(desc(schema.webhookInboundEvents.receivedAt))
          .limit(input.limit);

        return rows.map((row) => ({
          ...row,
          status: webhookDomain.classifyInboundWebhookEvent(row),
        }));
      });
    }),

  replayInbound: authedProcedureWith("integration:connect")
    .input(z.object({ inboundEventId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.workspaceId) throw new TRPCError({ code: "BAD_REQUEST" });

      const replay = await bypassRls(async (db) => {
        const providerPairs = await listAllowedProviderAccounts(db, {
          workspaceId: ctx.user.workspaceId!,
          subAccountId: ctx.user.subAccountId,
        });
        const providerCondition = buildProviderCondition(providerPairs);
        if (!providerCondition) return null;

        const [row] = await db
          .select({
            id: schema.webhookInboundEvents.id,
            source: schema.webhookInboundEvents.source,
          })
          .from(schema.webhookInboundEvents)
          .where(and(eq(schema.webhookInboundEvents.id, input.inboundEventId), providerCondition))
          .limit(1);
        if (!row) return null;

        const eventName = getReplayEventName(row.source);
        if (!eventName) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Unsupported webhook source: ${row.source}`,
          });
        }

        await db
          .update(schema.webhookInboundEvents)
          .set({ processedAt: null, error: null })
          .where(eq(schema.webhookInboundEvents.id, row.id));

        return { id: row.id, source: row.source, eventName };
      });

      if (!replay) throw new TRPCError({ code: "NOT_FOUND" });

      await inngest.send({
        name: replay.eventName,
        data: { inboundEventId: replay.id },
      });

      return {
        id: replay.id,
        source: replay.source,
        status: "pending" as const,
        dispatched: true,
      };
    }),
});

async function listAllowedProviderAccounts(
  db: Db,
  input: { workspaceId: string; subAccountId: string | null; source?: string },
): Promise<ProviderAccountPair[]> {
  const connectionFilters = [
    eq(schema.dataSourceConnections.workspaceId, input.workspaceId),
    isNull(schema.dataSourceConnections.deletedAt),
    isNotNull(schema.dataSourceConnections.externalAccountId),
  ];
  if (input.subAccountId) {
    connectionFilters.push(eq(schema.dataSourceConnections.subAccountId, input.subAccountId));
  }
  if (input.source) {
    connectionFilters.push(eq(schema.dataSourceConnections.toolType, input.source));
  }

  const connections = await db
    .select({
      source: schema.dataSourceConnections.toolType,
      providerAccountId: schema.dataSourceConnections.externalAccountId,
    })
    .from(schema.dataSourceConnections)
    .where(and(...connectionFilters));

  const pairs: ProviderAccountPair[] = connections.flatMap((connection) =>
    connection.providerAccountId
      ? [{ source: connection.source, providerAccountId: connection.providerAccountId }]
      : [],
  );

  if (!input.source || input.source === "fathom") {
    pairs.push({ source: "fathom", providerAccountId: `workspace:${input.workspaceId}` });

    const subAccountRows = input.subAccountId
      ? [{ id: input.subAccountId }]
      : await db
          .select({ id: schema.subAccounts.id })
          .from(schema.subAccounts)
          .where(
            and(
              eq(schema.subAccounts.workspaceId, input.workspaceId),
              isNull(schema.subAccounts.deletedAt),
            ),
          );
    for (const subAccount of subAccountRows) {
      pairs.push({ source: "fathom", providerAccountId: `subAccount:${subAccount.id}` });
    }
  }

  return dedupeProviderPairs(pairs);
}

function buildProviderCondition(pairs: ProviderAccountPair[]) {
  const conditions = pairs.map((pair) =>
    and(
      eq(schema.webhookInboundEvents.source, pair.source),
      eq(schema.webhookInboundEvents.providerAccountId, pair.providerAccountId),
    ),
  );
  return conditions.length > 0 ? or(...conditions)! : null;
}

function buildStatusCondition(status?: webhookDomain.InboundWebhookEventStatus) {
  if (status === "pending") {
    return and(
      isNull(schema.webhookInboundEvents.processedAt),
      isNull(schema.webhookInboundEvents.error),
    );
  }
  if (status === "processed") {
    return and(
      isNotNull(schema.webhookInboundEvents.processedAt),
      isNull(schema.webhookInboundEvents.error),
    );
  }
  if (status === "failed") return isNotNull(schema.webhookInboundEvents.error);
  return null;
}

function getReplayEventName(source: string) {
  if (source === "gohighlevel") return "ghl.webhook.received";
  if (source === "aircall") return "aircall.webhook.received";
  if (source === "fathom") return "fathom.webhook.received";
  return null;
}

function dedupeProviderPairs(pairs: ProviderAccountPair[]) {
  const seen = new Set<string>();
  return pairs.filter((pair) => {
    const key = `${pair.source}:${pair.providerAccountId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
