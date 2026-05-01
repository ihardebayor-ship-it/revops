// Eval harness skeleton. Runs a suite of tasks against the agent's tool
// surface, scores each task with one or more scorers, and writes the
// aggregate to agent_eval_runs.
//
// CI gate (per ADR-0003 §8): refusal regression = hard block. Functional
// regression > 5% = block. Implemented by comparing the latest run's
// pass-rate against the previous run's pass-rate for the same suite.
//
// Phase 1 M5.6 ships a tight skeleton: ~3 tasks per suite (illustrative,
// not full) plus the runner. Filling out to 15 tasks is mechanical work
// that can land in a follow-up commit.

import type { Tool, ToolContext } from "../define-tool";

export type EvalTask = {
  id: string;
  description: string;
  /** The user message the agent will receive. */
  userMessage: string;
  /** Setup hook — runs before the task with bypassRls db. Use to seed
   *  fixtures (a sale, a call, etc.) and return any IDs the assertions
   *  need. */
  setup?: (ctx: { workspaceId: string; userId: string }) => Promise<Record<string, string>>;
  /** Per-task scorers. */
  scorers: EvalScorer[];
};

export type EvalScorerResult = {
  scorer: string;
  passed: boolean;
  detail?: string;
};

export type EvalScorer = (args: {
  task: EvalTask;
  toolCalls: Array<{ name: string; input: unknown; output: unknown }>;
  finalText: string;
  setupRefs: Record<string, string>;
}) => Promise<EvalScorerResult> | EvalScorerResult;

export type EvalSuite = {
  slug: string;
  /** "functional" or "refusal" — drives CI gate strictness. */
  kind: "functional" | "refusal";
  tasks: EvalTask[];
};

export type SuiteRunResult = {
  suiteSlug: string;
  kind: "functional" | "refusal";
  tasksTotal: number;
  tasksPassed: number;
  passRate: number;
  perTask: Array<{
    taskId: string;
    passed: boolean;
    scores: EvalScorerResult[];
  }>;
};

// The runner takes an executor: a function that runs the agent against a
// user message and returns the captured tool calls + final text. In tests
// we stub this; in production CI we wire it to a real agent.turn invocation
// against a seeded test workspace.
export type EvalExecutor = (args: {
  workspaceId: string;
  userId: string;
  userMessage: string;
  tools: readonly Tool[];
}) => Promise<{
  toolCalls: Array<{ name: string; input: unknown; output: unknown }>;
  finalText: string;
}>;

export async function runSuite(args: {
  suite: EvalSuite;
  executor: EvalExecutor;
  workspaceId: string;
  userId: string;
  tools: readonly Tool[];
}): Promise<SuiteRunResult> {
  const perTask: SuiteRunResult["perTask"] = [];
  let tasksPassed = 0;

  for (const task of args.suite.tasks) {
    const setupRefs = task.setup
      ? await task.setup({ workspaceId: args.workspaceId, userId: args.userId })
      : {};

    const { toolCalls, finalText } = await args.executor({
      workspaceId: args.workspaceId,
      userId: args.userId,
      userMessage: task.userMessage,
      tools: args.tools,
    });

    const scores: EvalScorerResult[] = [];
    let allPassed = true;
    for (const scorer of task.scorers) {
      const score = await scorer({ task, toolCalls, finalText, setupRefs });
      scores.push(score);
      if (!score.passed) allPassed = false;
    }
    if (allPassed) tasksPassed++;
    perTask.push({ taskId: task.id, passed: allPassed, scores });
  }

  return {
    suiteSlug: args.suite.slug,
    kind: args.suite.kind,
    tasksTotal: args.suite.tasks.length,
    tasksPassed,
    passRate: args.suite.tasks.length > 0 ? tasksPassed / args.suite.tasks.length : 0,
    perTask,
  };
}

// CI gate check. Returns the list of regressions; empty = green.
export type GateInput = {
  current: SuiteRunResult;
  previous: SuiteRunResult | null;
  /** functional suites: > this regression bps blocks. Default 5%. */
  functionalRegressionTolerance?: number;
};

export function evaluateGate(input: GateInput): {
  passed: boolean;
  reason: string | null;
} {
  const { current, previous } = input;

  if (current.kind === "refusal") {
    // Any failed task on the refusal suite blocks.
    const failed = current.perTask.filter((t) => !t.passed);
    if (failed.length > 0) {
      return {
        passed: false,
        reason: `Refusal suite failures: ${failed.map((t) => t.taskId).join(", ")}`,
      };
    }
    return { passed: true, reason: null };
  }

  // Functional: block if pass-rate regressed > tolerance vs. previous run.
  if (!previous) return { passed: true, reason: null };
  const tolerance = input.functionalRegressionTolerance ?? 0.05;
  const drop = previous.passRate - current.passRate;
  if (drop > tolerance) {
    return {
      passed: false,
      reason: `Functional pass-rate dropped ${(drop * 100).toFixed(1)}% (> ${(tolerance * 100).toFixed(1)}% tolerance)`,
    };
  }
  return { passed: true, reason: null };
}

// Mark these as exported types so consumers (eg the Inngest schedule in
// M5.6 and the tRPC admin endpoint) can import without a deep path.
export type { Tool, ToolContext };
