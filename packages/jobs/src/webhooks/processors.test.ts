import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activeTenantDb: undefined as FakeDb | undefined,
  andCalls: [] as unknown[][],
  eqCalls: [] as unknown[][],
  emitFunnelEvent: vi.fn(),
  schema: {
    agentFacts: { table: "agent_facts" },
    calls: {
      id: "calls.id",
      externalId: "calls.external_id",
      sourceIntegration: "calls.source_integration",
      subAccountId: "calls.sub_account_id",
    },
    customers: {
      id: "customers.id",
      primaryEmail: "customers.primary_email",
      workspaceId: "customers.workspace_id",
      subAccountId: "customers.sub_account_id",
    },
    dataSourceConnections: {
      workspaceId: "data_source_connections.workspace_id",
      subAccountId: "data_source_connections.sub_account_id",
      toolType: "data_source_connections.tool_type",
      externalAccountId: "data_source_connections.external_account_id",
    },
    webhookInboundEvents: {
      id: "webhook_inbound_events.id",
      source: "webhook_inbound_events.source",
      providerAccountId: "webhook_inbound_events.provider_account_id",
      externalId: "webhook_inbound_events.external_id",
      payload: "webhook_inbound_events.payload",
      processedAt: "webhook_inbound_events.processed_at",
    },
  },
  withTenant: vi.fn(async (_scope: unknown, fn: (db: FakeDb) => Promise<unknown>) => {
    if (!mocks.activeTenantDb) throw new Error("tenant db not configured");
    return fn(mocks.activeTenantDb);
  }),
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
  bypassRls: vi.fn(async (fn: (db: FakeDb) => Promise<unknown>) => fn(createDb())),
  schema: mocks.schema,
  withTenant: mocks.withTenant,
}));

vi.mock("@revops/domain", () => ({
  funnel: {
    emitFunnelEvent: mocks.emitFunnelEvent,
  },
}));

vi.mock("@revops/integrations/shared", () => ({
  embedTexts: vi.fn(async (chunks: string[]) => ({
    vectors: chunks.map(() => [0.1, 0.2, 0.3]),
    totalTokens: chunks.length * 10,
  })),
}));

vi.mock("@revops/observability", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../client", () => ({
  inngest: {
    createFunction: vi.fn((_opts: unknown, _trigger: unknown, handler: unknown) => handler),
  },
}));

const { processGhlInboundEvent } = await import("./ghl-handler");
const { processAircallInboundEvent } = await import("./aircall-handler");
const { processFathomInboundEvent } = await import("./fathom-handler");
const { aircallEndedFixture } = await import("@revops/integrations/aircall");
const { fathomRecordingCompletedFixture } = await import("@revops/integrations/fathom");
const { ghlAppointmentCreateFixture } = await import("@revops/integrations/ghl");
const mockSchema = mocks.schema;

describe("webhook processors", () => {
  beforeEach(() => {
    mocks.activeTenantDb = undefined;
    mocks.andCalls = [];
    mocks.eqCalls = [];
    mocks.emitFunnelEvent.mockReset();
    mocks.withTenant.mockClear();
  });

  it("processes GHL events inside the resolved connection tenant", async () => {
    const mainDb = createDb({
      selectResults: [
        [
          {
            id: "inbound-ghl-1",
            payload: ghlAppointmentCreateFixture,
            processedAt: null,
          },
        ],
        [{ workspaceId: "workspace-1", subAccountId: "sub-1" }],
      ],
    });
    const tenantDb = createDb({
      selectResults: [[]],
      returningResults: [[{ id: "call-1" }]],
    });
    mocks.activeTenantDb = tenantDb;

    const result = await processGhlInboundEvent(mainDb as never, "inbound-ghl-1");

    expect(result).toEqual({ skipped: false, callId: "call-1", createdNew: true });
    expect(mocks.withTenant).toHaveBeenCalledWith(
      {
        userId: "webhook:gohighlevel",
        workspaceId: "workspace-1",
        subAccountId: "sub-1",
        accessRole: "sub_account_admin",
        isSuperadmin: false,
      },
      expect.any(Function),
    );
    expect(tenantDb.inserts[0]?.values).toMatchObject({
      workspaceId: "workspace-1",
      subAccountId: "sub-1",
      sourceIntegration: "gohighlevel",
      externalId: "appointment-1",
    });
    expect(mocks.emitFunnelEvent).toHaveBeenCalledWith(
      tenantDb,
      expect.objectContaining({
        workspaceId: "workspace-1",
        subAccountId: "sub-1",
        entityId: "call-1",
        sourceEventId: "inbound-ghl-1",
      }),
    );
  });

  it("processes Aircall events inside the resolved connection tenant", async () => {
    const mainDb = createDb({
      selectResults: [
        [
          {
            id: "inbound-aircall-1",
            payload: aircallEndedFixture,
            processedAt: null,
          },
        ],
        [{ workspaceId: "workspace-2", subAccountId: "sub-2" }],
      ],
    });
    const tenantDb = createDb({
      selectResults: [[]],
      returningResults: [[{ id: "call-2" }]],
    });
    mocks.activeTenantDb = tenantDb;

    const result = await processAircallInboundEvent(mainDb as never, "inbound-aircall-1");

    expect(result).toEqual({ skipped: false, callId: "call-2", createdNew: true });
    expect(mocks.withTenant).toHaveBeenCalledWith(
      {
        userId: "webhook:aircall",
        workspaceId: "workspace-2",
        subAccountId: "sub-2",
        accessRole: "sub_account_admin",
        isSuperadmin: false,
      },
      expect.any(Function),
    );
    expect(tenantDb.inserts[0]?.values).toMatchObject({
      workspaceId: "workspace-2",
      subAccountId: "sub-2",
      sourceIntegration: "aircall",
      externalId: "aircall-call-1",
    });
    expect(mocks.emitFunnelEvent).toHaveBeenCalledWith(
      tenantDb,
      expect.objectContaining({
        workspaceId: "workspace-2",
        subAccountId: "sub-2",
        stageSlug: "completed",
        sourceEventId: "inbound-aircall-1",
      }),
    );
  });

  it("constrains Fathom customer matching to the webhook sub-account scope", async () => {
    const mainDb = createDb({
      selectResults: [
        [
          {
            id: "inbound-fathom-1",
            providerAccountId: "subAccount:sub-allowed",
            payload: fathomRecordingCompletedFixture,
            processedAt: null,
          },
        ],
        [
          {
            id: "customer-1",
            workspaceId: "workspace-3",
            subAccountId: "sub-allowed",
          },
        ],
      ],
    });
    const tenantDb = createDb();
    mocks.activeTenantDb = tenantDb;

    const result = await processFathomInboundEvent(mainDb as never, "inbound-fathom-1");

    expect(result).toEqual({ skipped: false, customerId: "customer-1", chunks: 1, tokens: 10 });
    expect(mocks.eqCalls).toContainEqual([mockSchema.customers.subAccountId, "sub-allowed"]);
    expect(mocks.eqCalls).not.toContainEqual([mockSchema.customers.workspaceId, "sub-allowed"]);
    expect(mocks.withTenant).toHaveBeenCalledWith(
      {
        userId: "webhook:fathom",
        workspaceId: "workspace-3",
        subAccountId: "sub-allowed",
        accessRole: "sub_account_admin",
        isSuperadmin: false,
      },
      expect.any(Function),
    );
    expect(tenantDb.inserts[0]?.table).toBe(mockSchema.agentFacts);
    expect(tenantDb.inserts[0]?.values).toMatchObject({
      workspaceId: "workspace-3",
      scope: "customer",
      scopeRefId: "customer-1",
      kind: "fact",
      confidence: "0.70",
    });
  });

  it("does not process Fathom events with an invalid provider account key", async () => {
    const mainDb = createDb({
      selectResults: [
        [
          {
            id: "inbound-fathom-2",
            providerAccountId: "global",
            payload: {
              recording_id: "recording-2",
              calendar_invitees: [{ email: "buyer@example.test" }],
            },
            processedAt: null,
          },
        ],
      ],
    });

    const result = await processFathomInboundEvent(mainDb as never, "inbound-fathom-2");

    expect(result).toEqual({ skipped: true, reason: "invalid_provider_account_id" });
    expect(mocks.withTenant).not.toHaveBeenCalled();
    expect(mainDb.updates[0]?.values).toMatchObject({ error: "invalid_provider_account_id" });
  });
});

type FakeDb = ReturnType<typeof createDb>;

function createDb(args?: { selectResults?: unknown[][]; returningResults?: unknown[][] }) {
  const selectResults = [...(args?.selectResults ?? [])];
  const returningResults = [...(args?.returningResults ?? [])];
  const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];

  return {
    inserts,
    updates,
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => selectResults.shift() ?? []),
        })),
      })),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updates.push({ table, values });
        return { where: vi.fn(async () => undefined) };
      }),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Record<string, unknown>) => {
        inserts.push({ table, values });
        return { returning: vi.fn(async () => returningResults.shift() ?? []) };
      }),
    })),
  };
}
