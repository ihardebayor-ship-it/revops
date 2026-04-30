// defineTool — the single contract for every tool the agent can call.
// Produces three artifacts from one declaration:
//   1. The Anthropic tool-use schema (via zodToJsonSchema)
//   2. The tRPC procedure (so the UI can call the same surface)
//   3. The typed function the Inngest workflow invokes
// See ADR-0003 §2 for the full contract.

import { z, type ZodSchema, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { type AuthContext } from "@revops/auth/policy";
import { type Db } from "@revops/db/client";

export type ToolRisk = "low" | "medium" | "high";

export type ToolContext = {
  db: Db;
  user: AuthContext;
  workspaceId: string;
  subAccountId: string | null;
  agentTraceId?: string;
};

export type ToolDefinition<TInput extends ZodTypeAny, TOutput extends ZodTypeAny> = {
  name: string;
  category: string;
  description: string;
  input: TInput;
  output: TOutput;
  authorize: (args: { ctx: ToolContext; input: z.infer<TInput> }) => boolean | Promise<boolean>;
  risk: ToolRisk;
  reversible: boolean;
  idempotent?: boolean;
  idempotencyKey?: (args: { input: z.infer<TInput> }) => string;
  run: (args: { ctx: ToolContext; input: z.infer<TInput> }) => Promise<z.infer<TOutput>>;
};

export type Tool = {
  name: string;
  category: string;
  description: string;
  input: ZodSchema;
  output: ZodSchema;
  risk: ToolRisk;
  reversible: boolean;
  idempotent: boolean;
  toAnthropicSchema: () => {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  };
  authorize: (args: { ctx: ToolContext; input: unknown }) => Promise<boolean>;
  execute: (args: { ctx: ToolContext; input: unknown }) => Promise<unknown>;
};

export function defineTool<TInput extends ZodTypeAny, TOutput extends ZodTypeAny>(
  def: ToolDefinition<TInput, TOutput>,
): Tool {
  if (!def.name.match(/^[a-z][A-Za-z0-9]*$/)) {
    throw new Error(`Tool name must be camelCase: ${def.name}`);
  }
  return {
    name: def.name,
    category: def.category,
    description: def.description,
    input: def.input,
    output: def.output,
    risk: def.risk,
    reversible: def.reversible,
    idempotent: def.idempotent ?? false,
    toAnthropicSchema: () => ({
      name: def.name,
      description: def.description,
      input_schema: zodToJsonSchema(def.input, {
        $refStrategy: "none",
        target: "openApi3",
      }) as Record<string, unknown>,
    }),
    authorize: async ({ ctx, input }) => {
      const parsed = def.input.parse(input);
      return Promise.resolve(def.authorize({ ctx, input: parsed }));
    },
    execute: async ({ ctx, input }) => {
      const parsed = def.input.parse(input);
      const result = await def.run({ ctx, input: parsed });
      return def.output.parse(result);
    },
  };
}
