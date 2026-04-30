// Model routing — deterministic, ~50 lines as promised in ADR-0003 §3.
// The router decides which Claude model handles a given turn based on task
// characteristics. Hard caps and prompt caching are enforced elsewhere.

export type ClaudeModel =
  | "claude-haiku-4-5"
  | "claude-sonnet-4-6"
  | "claude-opus-4-7";

export type RoutingHint = {
  taskKind: "summarization" | "classification" | "fact_extraction" | "default";
  userRequestedDeepMode?: boolean;
  detectedAmbiguity?: boolean;
  multiStepEntityCount?: number;
  isSubAgent?: boolean;
};

export function chooseModel(hint: RoutingHint): ClaudeModel {
  if (hint.isSubAgent) return "claude-haiku-4-5";

  if (
    hint.taskKind === "summarization" ||
    hint.taskKind === "classification" ||
    hint.taskKind === "fact_extraction"
  ) {
    return "claude-haiku-4-5";
  }

  if (hint.userRequestedDeepMode) return "claude-opus-4-7";
  if (hint.detectedAmbiguity) return "claude-opus-4-7";
  if ((hint.multiStepEntityCount ?? 0) > 5) return "claude-opus-4-7";

  return "claude-sonnet-4-6";
}

// Cost-cap defaults from ADR-0003 §3. Workspace-level caps live in
// workspace_settings.agent_*_cost_cap_usd and override these at runtime.
export const COST_CAPS = {
  perTurnUsdMvp: 0.5,
  perTurnUsdPaid: 5.0,
  perWorkspaceDailyUsdMvp: 25,
  perUserHourlyUsd: 5,
  promptCacheHitRateTarget: 0.8,
  promptCacheHitRateAlertFloor: 0.5,
} as const;
