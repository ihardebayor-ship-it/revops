import { describe, expect, it } from "vitest";
import type { AuthContext } from "@revops/auth/policy";
import { ALL_TOOLS, getReadOnlyTools } from "./index";

const uuid = "11111111-1111-4111-8111-111111111111";
const iso = "2026-01-02T10:00:00.000Z";

const inputByToolName: Record<string, unknown> = {
  searchCalls: {},
  searchSales: {},
  getForecast: {},
  getAtRiskCustomers: {},
  getTeamLeaderboard: {},
  linkSaleToCall: { saleId: uuid, callId: uuid },
  unlinkSaleFromCall: { saleId: uuid, callId: uuid },
  setCallDisposition: { callId: uuid, dispositionId: uuid },
  setCallOutcome: { callId: uuid, completedAt: iso, durationSeconds: 120 },
  createTask: { kind: "custom", title: "Follow up", uniqueKey: "test-task" },
  completeTask: { taskId: uuid },
  snoozeTask: { taskId: uuid, snoozedUntil: iso },
  recordFollowUp: {
    relatedEntityType: "customer",
    relatedEntityId: uuid,
    dueAt: iso,
    reason: "Buyer asked for next steps",
  },
  proposeCommissionLink: {
    saleId: uuid,
    callId: uuid,
    confidence: 0.9,
    rationale: "Sale and call metadata match",
  },
  confirmFact: { factId: uuid },
  contradictFact: { factId: uuid },
};

const viewerAllowed = new Set(["searchCalls", "searchSales", "getForecast", "getAtRiskCustomers"]);

describe("agent tool authorization", () => {
  it("keeps every registered tool covered by authorization fixtures", () => {
    expect(Object.keys(inputByToolName).sort()).toEqual(ALL_TOOLS.map((tool) => tool.name).sort());
  });

  it("does not expose mutation or manager-only tools to viewers", async () => {
    const ctx = toolCtx(authCtx("viewer"));

    for (const tool of ALL_TOOLS) {
      const authorized = await tool.authorize({ ctx, input: inputByToolName[tool.name] });
      expect(authorized).toBe(viewerAllowed.has(tool.name));
    }
  });

  it("does not expose any tools without an access role", async () => {
    const ctx = toolCtx({ ...authCtx(null), accessRole: null });

    for (const tool of ALL_TOOLS) {
      await expect(tool.authorize({ ctx, input: inputByToolName[tool.name] })).resolves.toBe(false);
    }
  });

  it("keeps read-only registry limited to low-risk idempotent tools", () => {
    for (const tool of getReadOnlyTools()) {
      expect(tool.risk).toBe("low");
      expect(tool.idempotent).toBe(true);
    }
  });
});

function authCtx(accessRole: AuthContext["accessRole"]): AuthContext {
  return {
    userId: "user-1",
    workspaceId: "workspace-1",
    subAccountId: "sub-1",
    accessRole,
    salesRoleSlugs: [],
    isSuperadmin: false,
  };
}

function toolCtx(user: AuthContext) {
  return {
    db: {} as never,
    user,
    workspaceId: "workspace-1",
    subAccountId: "sub-1",
    actorKind: "agent_on_behalf_of_user" as const,
  };
}
