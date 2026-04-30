// Langfuse — LLM tracing. Phase 0: no-op shim. Phase 1: wire into
// `callClaude` so every Anthropic call emits a trace with prompt,
// response, tool calls, latency, cost, eval score.

export type LLMTrace = {
  threadId?: string;
  workspaceId?: string;
  userId?: string;
  model: string;
  prompt: string;
  response: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  toolCalls?: Array<{ name: string; input: Record<string, unknown> }>;
};

export interface LangfuseClient {
  traceLLMCall(trace: LLMTrace): void;
}

const noopLangfuse: LangfuseClient = {
  traceLLMCall: () => {},
};

let cached: LangfuseClient | null = null;

export function initLangfuse(): LangfuseClient {
  if (cached) return cached;
  cached = noopLangfuse;
  return cached;
}

export const traceLLMCall: LangfuseClient["traceLLMCall"] = (trace) =>
  initLangfuse().traceLLMCall(trace);
