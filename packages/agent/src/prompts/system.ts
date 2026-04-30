// Cached system prompt builder. The order of blocks is intentional — earlier
// blocks are stable across turns and benefit from prompt caching.
// See ADR-0003 §5.

import { type Tool } from "../define-tool";

export type SystemPromptInput = {
  brand: { name: string; agentPersona: { name: string; voice: string } };
  workspace: { name: string; topology: string; salesRoleVocabulary: string[] };
  workspaceFacts: string[];
  threadSummary: string | null;
  retrievedFacts: string[];
  availableTools: readonly Tool[];
};

export function buildSystemPrompt(input: SystemPromptInput): string {
  return [
    `You are ${input.brand.agentPersona.name}, the ${input.brand.name} agent.`,
    `Voice: ${input.brand.agentPersona.voice}`,
    "",
    "## Hard rules",
    "- You act as the calling user. You cannot bypass authorization.",
    "- You cannot view data outside the user's workspace.",
    "- Risky actions require explicit user approval before you execute them.",
    "- Refuse cross-workspace requests, mass-mutation without approval, and external messaging without consent.",
    "",
    `## This workspace`,
    `Name: ${input.workspace.name}`,
    `Topology: ${input.workspace.topology}`,
    `Sales role vocabulary: ${input.workspace.salesRoleVocabulary.join(", ")}`,
    "",
    "## Available tools",
    ...input.availableTools.map((t) => `- ${t.name} (${t.category}): ${t.description}`),
    "",
    input.workspaceFacts.length > 0
      ? `## Workspace rules\n${input.workspaceFacts.map((f) => `- ${f}`).join("\n")}\n`
      : "",
    input.threadSummary ? `## Earlier in this thread\n${input.threadSummary}\n` : "",
    input.retrievedFacts.length > 0
      ? `## Known facts\n${input.retrievedFacts.map((f) => `- ${f}`).join("\n")}\n`
      : "",
  ].join("\n");
}
