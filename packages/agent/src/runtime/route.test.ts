import { describe, expect, it } from "vitest";
import { chooseModel, COST_CAPS } from "./route";

describe("agent routing and budget defaults", () => {
  it("routes cheap deterministic work to Haiku", () => {
    expect(chooseModel({ taskKind: "summarization" })).toBe("claude-haiku-4-5");
    expect(chooseModel({ taskKind: "classification" })).toBe("claude-haiku-4-5");
    expect(chooseModel({ taskKind: "fact_extraction" })).toBe("claude-haiku-4-5");
    expect(chooseModel({ taskKind: "default", isSubAgent: true })).toBe("claude-haiku-4-5");
  });

  it("routes expensive ambiguous work deliberately", () => {
    expect(chooseModel({ taskKind: "default", detectedAmbiguity: true })).toBe("claude-opus-4-7");
    expect(chooseModel({ taskKind: "default", userRequestedDeepMode: true })).toBe(
      "claude-opus-4-7",
    );
    expect(chooseModel({ taskKind: "default", multiStepEntityCount: 6 })).toBe("claude-opus-4-7");
  });

  it("keeps default cost caps bounded", () => {
    expect(COST_CAPS.perTurnUsdMvp).toBeGreaterThan(0);
    expect(COST_CAPS.perTurnUsdMvp).toBeLessThanOrEqual(0.5);
    expect(COST_CAPS.perWorkspaceDailyUsdMvp).toBeLessThanOrEqual(25);
    expect(COST_CAPS.perUserHourlyUsd).toBeLessThanOrEqual(5);
  });
});
