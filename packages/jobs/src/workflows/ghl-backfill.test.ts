import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activeDb: undefined as FakeDb | undefined,
  andCalls: [] as unknown[][],
  eqCalls: [] as unknown[][],
  clientGet: vi.fn(),
  inngestSend: vi.fn(),
  schema: {
    dataSourceConnections: {
      id: "data_source_connections.id",
      workspaceId: "data_source_connections.workspace_id",
      subAccountId: "data_source_connections.sub_account_id",
      accessTokenEncrypted: "data_source_connections.access_token_encrypted",
      externalAccountId: "data_source_connections.external_account_id",
      toolType: "data_source_connections.tool_type",
    },
    webhookInboundEvents: {
      id: "webhook_inbound_events.id",
      source: "webhook_inbound_events.source",
      providerAccountId: "webhook_inbound_events.provider_account_id",
      externalId: "webhook_inbound_events.external_id",
      payload: "webhook_inbound_events.payload",
      signatureVerified: "webhook_inbound_events.signature_verified",
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => {
    mocks.andCalls.push(args);
    return { op: "and", args };
  },
  eq: (...args: unknown[]) => {
    mocks.eqCalls.push(args);
    return { op: "eq", args };
  },
}));

vi.mock("@revops/db/client", () => ({
  bypassRls: vi.fn(async (fn: (db: FakeDb) => Promise<unknown>) => {
    if (!mocks.activeDb) throw new Error("db not configured");
    return fn(mocks.activeDb);
  }),
  schema: mocks.schema,
}));

vi.mock("@revops/integrations/shared", () => ({
  decryptToken: vi.fn(() => "access-token"),
}));

vi.mock("@revops/integrations/ghl", () => ({
  GHL_PROVIDER_ID: "gohighlevel",
  createGhlClient: vi.fn(() => ({ get: mocks.clientGet })),
}));

vi.mock("../client", () => ({
  inngest: {
    createFunction: vi.fn((_opts: unknown, _trigger: unknown, handler: unknown) => handler),
    send: mocks.inngestSend,
  },
}));

const { ghlBackfill } = await import("./ghl-backfill");
const mockSchema = mocks.schema;

describe("ghlBackfill", () => {
  beforeEach(() => {
    mocks.activeDb = undefined;
    mocks.andCalls = [];
    mocks.eqCalls = [];
    mocks.clientGet.mockReset();
    mocks.inngestSend.mockReset();
  });

  it("synthesizes inbound events with the GHL location as provider account", async () => {
    const db = createDb({
      selectResults: [[connectionRow()]],
      returningResults: [[{ id: "inbound-1" }]],
    });
    mocks.activeDb = db;
    mocks.clientGet.mockImplementation(async (path: string) => {
      if (path === "/calendars/") return { calendars: [{ id: "calendar-1" }] };
      return { events: [{ id: "appointment-1", startTime: "2026-01-01T10:00:00Z" }] };
    });

    const result = await runBackfill();

    expect(result).toEqual({ connectionId: "connection-1", synthesized: 1, calendars: 1 });
    expect(db.inserts[0]?.values).toMatchObject({
      source: "gohighlevel",
      providerAccountId: "location-1",
      externalId: "AppointmentCreate:appointment-1",
      signatureVerified: false,
      payload: {
        type: "AppointmentCreate",
        locationId: "location-1",
        appointment: { id: "appointment-1", startTime: "2026-01-01T10:00:00Z" },
      },
    });
    expect(db.inserts[0]?.conflictTarget).toEqual([
      mockSchema.webhookInboundEvents.source,
      mockSchema.webhookInboundEvents.providerAccountId,
      mockSchema.webhookInboundEvents.externalId,
    ]);
    expect(mocks.inngestSend).toHaveBeenCalledWith({
      name: "ghl.webhook.received",
      data: { inboundEventId: "inbound-1" },
    });
  });

  it("looks up deduped synthetic events by source, provider account, and external id", async () => {
    const db = createDb({
      selectResults: [[connectionRow()], [{ id: "existing-inbound-1" }]],
      returningResults: [[]],
    });
    mocks.activeDb = db;
    mocks.clientGet.mockImplementation(async (path: string) => {
      if (path === "/calendars/") return { calendars: [{ id: "calendar-1" }] };
      return { events: [{ id: "appointment-1", startTime: "2026-01-01T10:00:00Z" }] };
    });

    const result = await runBackfill();

    expect(result).toEqual({ connectionId: "connection-1", synthesized: 1, calendars: 1 });
    expect(mocks.eqCalls).toContainEqual([mockSchema.webhookInboundEvents.source, "gohighlevel"]);
    expect(mocks.eqCalls).toContainEqual([
      mockSchema.webhookInboundEvents.providerAccountId,
      "location-1",
    ]);
    expect(mocks.eqCalls).toContainEqual([
      mockSchema.webhookInboundEvents.externalId,
      "AppointmentCreate:appointment-1",
    ]);
    expect(mocks.inngestSend).toHaveBeenCalledWith({
      name: "ghl.webhook.received",
      data: { inboundEventId: "existing-inbound-1" },
    });
  });
});

type FakeDb = ReturnType<typeof createDb>;

function connectionRow() {
  return {
    id: "connection-1",
    workspaceId: "workspace-1",
    subAccountId: "sub-1",
    accessTokenEncrypted: "encrypted-token",
    externalAccountId: "location-1",
    toolType: "gohighlevel",
  };
}

async function runBackfill() {
  const handler = ghlBackfill as unknown as (ctx: unknown) => Promise<unknown>;
  return handler({
    event: { data: { connectionId: "connection-1", sinceDays: 7 } },
    step: { run: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()) },
  });
}

function createDb(args?: { selectResults?: unknown[][]; returningResults?: unknown[][] }) {
  const selectResults = [...(args?.selectResults ?? [])];
  const returningResults = [...(args?.returningResults ?? [])];
  const inserts: Array<{
    table: unknown;
    values: Record<string, unknown>;
    conflictTarget?: unknown[];
  }> = [];

  return {
    inserts,
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => selectResults.shift() ?? []),
        })),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Record<string, unknown>) => {
        const insert = { table, values, conflictTarget: undefined as unknown[] | undefined };
        inserts.push(insert);
        return {
          onConflictDoNothing: vi.fn(({ target }: { target: unknown[] }) => {
            insert.conflictTarget = target;
            return { returning: vi.fn(async () => returningResults.shift() ?? []) };
          }),
        };
      }),
    })),
  };
}
