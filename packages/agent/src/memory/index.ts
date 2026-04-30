// Memory module stub. Phase 0: types only. Phase 2: full implementation.
// See ADR-0003 §4 for the schema and write policy.

export type FactScope = "workspace" | "user" | "customer" | "thread";
export type FactKind = "preference" | "rule" | "fact" | "pattern";

export type AgentFact = {
  id: string;
  workspaceId: string;
  scope: FactScope;
  scopeRefId: string | null;
  kind: FactKind;
  content: string;
  confidence: number;
  confirmedByUserAt: Date | null;
  contradictedAt: Date | null;
};

// Embedding dimension target: text-embedding-3-small (1536). Matches the
// vector column dimension in the agent_facts schema.
export const EMBEDDING_DIM = 1536;
