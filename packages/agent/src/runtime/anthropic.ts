// Thin Anthropic client wrapper. Phase 0: non-streaming, one-shot calls.
// Phase 1: swap to streaming with prompt caching tuning.
import Anthropic from "@anthropic-ai/sdk";
import type { ClaudeModel } from "./route";

let cachedClient: Anthropic | null = null;

function getClient() {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required to call Claude");
  }
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

// Per-million-token pricing (USD), used to estimate per-call cost.
// Source: anthropic.com pricing as of 2026-04. Update via ADR if it shifts.
const PRICING_USD_PER_M_TOKENS: Record<ClaudeModel, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-7": { input: 15.0, output: 75.0 },
};

export type CallClaudeArgs = {
  model: ClaudeModel;
  system: string;
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
  maxTokens?: number;
};

export type ClaudeToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type CallClaudeResult = {
  text: string;
  toolCalls: ClaudeToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  rawId: string;
};

function estimateCostUsd(model: ClaudeModel, inputTokens: number, outputTokens: number): number {
  const p = PRICING_USD_PER_M_TOKENS[model];
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

export async function callClaude(args: CallClaudeArgs): Promise<CallClaudeResult> {
  const client = getClient();
  const response = await client.messages.create({
    model: args.model,
    max_tokens: args.maxTokens ?? 1500,
    system: args.system,
    tools: args.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    })),
    messages: args.messages as Array<Anthropic.MessageParam>,
  });

  let text = "";
  const toolCalls: ClaudeToolCall[] = [];
  for (const block of response.content) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      });
    }
  }

  return {
    text,
    toolCalls,
    stopReason: response.stop_reason ?? "end_turn",
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    costUsd: estimateCostUsd(args.model, response.usage.input_tokens, response.usage.output_tokens),
    rawId: response.id,
  };
}
