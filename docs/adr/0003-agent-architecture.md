# ADR-0003 — Agent Architecture

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-04-30 |
| **Deciders** | antonio (founder), Claude (architect) |
| **Supersedes** | — |
| **Superseded by** | — |

---

## Context

Principle #2 in [ARCHITECTURE.md §1.3](../ARCHITECTURE.md): *the agent is foundational, not a bolt-on.* The product is conceived as agent-native — every domain action is a tool the agent can call, and humans and the agent share one surface.

[ARCHITECTURE.md §8](../ARCHITECTURE.md) sketches the agent at high level: durable Inngest workflow, typed tool registry, three-layer memory (turn history + summaries + pgvector facts), Langfuse observability, model routing across Sonnet 4.6 / Opus 4.7 / Haiku 4.5, golden-task evals.

That sketch is not enough to build against. This ADR locks the **operational details** that determine whether the agent is elite or just expensive: the exact execution-loop shape, the tool-registry contract, model routing thresholds with cost guardrails, memory schema and write policy, context construction and prompt-caching strategy, streaming UX rules, approval gates for risky actions, the eval harness, failure modes, and the Phase-0/1 tool surface.

The old app's agent was a feature-flagged-off chat box. We are building the opposite: an operator that takes durable, audited, scoped action across the system on the user's behalf. That requires more decisions than a chat surface.

## Decision

### 1. Execution model

The agent runs as an **Inngest durable workflow**, not an inline server-action loop.

```
[POST /api/agent/messages]
    │
    ├── persist user turn → agent_messages
    ├── send Inngest event "agent.turn.requested" with { threadId, userId, turnId }
    └── return 202 + Pusher channel token

[Inngest function "agent.turn"]
    step.run("load-context")        → memory + RAG + tool-list-curation
    step.run("plan-and-stream")     → Claude call, streams to Pusher
    while (toolCallRequested) {
      step.run("authorize-tool")    → can(user, action, resource)
      step.run("execute-tool")      → domain.<tool>(ctx, input) + audit_log
      step.run("continue-stream")   → Claude continuation with tool result
    }
    step.run("commit-turn")         → write final assistant_message,
                                       update summary if N turns elapsed,
                                       commit any new agent_facts
    step.run("emit-langfuse-trace") → flush full trace
```

Why a durable workflow:

- **Survives crashes and timeouts.** A 30-step agent run that takes 4 minutes does not die when a serverless function recycles. Inngest checkpoints between steps.
- **Retries are free.** Network blip on a Claude call retries that step only, not the whole turn.
- **Replay is debuggable.** A failed turn can be replayed with full input fidelity from Inngest's UI.
- **Cost attribution is automatic.** Each step has a duration, an outcome, and a Langfuse trace ID.

Each turn has a hard ceiling: **20 tool calls or 8 minutes wall-clock**. Hitting the ceiling closes the turn with a partial response and an explicit "I hit my limit, want me to continue?" prompt to the user.

### 2. Tool registry contract

Tools live in `packages/agent/tools/<domain>/<tool>.ts`. Every tool is defined via one helper that produces three artifacts: the Anthropic tool-use schema, the tRPC procedure (so the UI can call the same surface), and the typed function the workflow invokes.

```ts
// packages/agent/tools/sales/link-sale-to-call.ts
export const linkSaleToCall = defineTool({
  name: "linkSaleToCall",
  category: "sales",
  description:
    "Link a sale to its originating call. Use this when reconciling unlinked sales — " +
    "for example after the user asks to clean up the unlinked sales queue.",
  input: z.object({
    saleId: z.string().uuid(),
    callId: z.string().uuid(),
    confidence: z.enum(["certain", "high", "medium"]).default("certain"),
  }),
  output: z.object({ linkedAt: z.string().datetime() }),

  // Authorization (required, runs before execution)
  authorize: ({ ctx, input }) =>
    can(ctx.user, "sale:update", { saleId: input.saleId }),

  // Risk classification (drives approval gating; see §6)
  risk: "low",          // "low" | "medium" | "high"
  reversible: true,

  // Idempotency (required; lookup key for replay safety)
  idempotencyKey: ({ input }) => `link-sale:${input.saleId}:${input.callId}`,

  // Execution
  run: async ({ ctx, input }) =>
    domain.sales.linkToCall(ctx, input),
});
```

Rules:

- **No tool may bypass authorization.** Every tool declares an `authorize` function that resolves through the same `can()` policy used by tRPC and Server Actions ([§7.5](../ARCHITECTURE.md)). Missing `authorize` is a compile-time error.
- **Every tool declares risk and reversibility.** These drive the approval-gate policy (§6).
- **Every tool is idempotent or declares it isn't.** Idempotency keys gate replay; non-idempotent tools must declare `idempotent: false` and accept that replay can double-write.
- **Every tool execution writes one `audit_log` row.** The helper handles this; tool authors don't write it manually.
- **Every tool's input and output are Zod schemas.** The Anthropic tool-use schema is generated from the Zod schema. No drift between what the agent sees and what the function expects.
- **Tool names are camelCase verbs.** `linkSaleToCall`, `approveCommission`, `scheduleFollowUp`. Discoverable by the model.

Tools are auto-registered at boot via a Vite-style file glob inside `packages/agent/tools/` so adding a tool is one file, no central registry to update.

### 3. Model routing policy

Three Claude models, one router. The router lives in `packages/agent/runtime/route.ts` and is deterministic, not LLM-driven.

| Model | Use cases | Cost-tier |
|---|---|---|
| **Sonnet 4.6** | Default for every turn unless an exception fires | Mid |
| **Opus 4.7** | (a) user explicitly enables "deep mode"; (b) detected ambiguity in user input (planner returns `confidence: "low"`); (c) tool call requires multi-step planning over >5 entities; (d) commission rule authoring or critical workflow design | Premium |
| **Haiku 4.5** | (a) thread summarization after every N turns; (b) sub-agent tasks spawned in parallel (e.g. "review these 50 calls" → 50 Haiku calls); (c) classification (intent routing, disposition suggestions); (d) fact-extraction for `agent_facts` writes | Cheap |

Per-turn cost cap: **$0.50 (MVP), $5 (paid tier)**. Hitting the cap downgrades the next call to Haiku and warns Langfuse. Hitting it twice in one turn closes the turn with a "your request is too large for one shot" message.

Per-workspace daily cap: **$25 (MVP)**, configurable upward by `workspace_admin` or `superadmin`. Hitting it disables the agent for the day with a clear admin-visible warning.

**Prompt caching is on for every Claude call.** System prompt + tool definitions + the workspace's persona block are cached. Target cache hit rate: ≥80% on `agent_messages.continuation` calls within the same thread. Langfuse alerts if hit rate drops below 50% over a rolling 6-hour window.

### 4. Memory architecture

Three layers, all in Postgres:

```
agent_threads
├── id, workspace_id, sub_account_id, user_id
├── title (auto-generated by Haiku from first user message)
├── summary (rolling, updated every 8 turns by Haiku)
├── token_count_estimate (running)
├── created_at, last_message_at, archived_at

agent_messages
├── id, thread_id, turn_id
├── role ("user" | "assistant" | "tool_call" | "tool_result" | "system_event")
├── content (jsonb)         ─── structured: text, tool_call, tool_result
├── model (when role=assistant)
├── token_usage jsonb       ─── input/output/cache hits
├── langfuse_trace_id
├── created_at

agent_facts                              (semantic memory)
├── id, workspace_id, scope ("workspace"|"user"|"customer"|"thread")
├── scope_ref_id            ─── e.g. customer_id or user_id when scope is non-workspace
├── kind ("preference"|"rule"|"fact"|"pattern")
├── content (text)
├── source_message_id       ─── where the fact came from
├── embedding vector(1536)  ─── pgvector
├── confidence (numeric)
├── confirmed_by_user_at, contradicted_at
├── created_at, updated_at

agent_eval_runs
├── id, suite_slug, run_at, model, scorer_version
├── score_summary jsonb, regressions jsonb, langfuse_run_id
```

**Write policy for `agent_facts`:** the planner emits a `proposeFact` tool call when it learns something durable about the workspace, user, or customer. The tool runs through authz, embeds the content with the same embedding model used for retrieval (Voyage AI free tier or `text-embedding-3-small` via OpenAI when token cost is lower), writes the row at `confidence: 0.6`. A user can confirm or contradict via UI; confirmation pushes confidence to 1.0, contradiction sets `contradicted_at` and the fact is excluded from retrieval thereafter (kept for audit).

**Retrieval at turn start:** k=8 by similarity over `agent_facts` filtered by workspace and (when relevant) the user/customer in scope. Hybrid with full-text search on the content column when query is keyword-shaped (>3 capitalized terms or contains numbers). Retrieved facts are injected into the system prompt under a `## Known facts` section, ordered by similarity score.

**Summarization:** every 8 user turns, a Haiku call rewrites `agent_threads.summary` and prunes raw `agent_messages` from the next turn's context. Pruned messages are kept in DB for audit; not loaded into the model.

### 5. Context construction

What goes into each Claude call (in order, for prompt-cache stability):

1. **System prompt** (cached) — fixed across all turns in the thread:
   - Brand persona (from `platform_settings`, or workspace whitelabel override)
   - Workspace topology vocabulary ("In this workspace, sales roles are: setter, closer, cx")
   - Hard rules ("You act as the user. You cannot bypass authorization. You cannot view other workspaces.")
   - Available tools list (auto-generated from registry, filtered by user permissions)
2. **Workspace facts** (cached when stable, refreshed on fact write) — the top 3 confirmed `agent_facts` of `kind: "rule"` for this workspace.
3. **Thread summary** (cached when summary unchanged) — the rolling summary of pruned earlier turns.
4. **Retrieved facts** (per-turn, not cached) — k=8 similarity hits.
5. **Recent message history** (per-turn, not cached) — the last 8 turns verbatim.
6. **Current user message** (per-turn).

Cached blocks use Anthropic's `cache_control: { type: "ephemeral" }`. Target: parts 1–3 cache for the duration of a thread; parts 4–6 are computed per turn.

### 6. Streaming UX & approval gates

Streaming over Pusher. The browser subscribes to `agent-thread-<threadId>` and receives events:

| Event | Emitted when | Shown as |
|---|---|---|
| `agent.thinking` | Workflow loaded context, before Claude call | "Reasoning…" |
| `agent.text.delta` | Streaming text from Claude | Inline text |
| `agent.tool.proposed` | Claude requested a tool, before execution | Pill: "Linking sale #4821 to call #312" |
| `agent.tool.awaiting_approval` | Tool risk requires approval | Modal: confirm/cancel |
| `agent.tool.executing` | Authz passed, running | Pill spinner |
| `agent.tool.completed` | Tool returned | Pill checkmark with summary |
| `agent.tool.failed` | Tool errored | Pill error with retry |
| `agent.turn.complete` | Workflow done | Input re-enabled |

**Approval gates by tool risk:**

- `risk: "low"` (read, link, suggest): execute silently with a transparent pill.
- `risk: "medium"` (mutate single entity, e.g. update commission status): execute with a one-second "Cancel" affordance the user can hit before the step.run completes.
- `risk: "high"` (mutate financial state, send external messages, mutate >5 entities at once): block on explicit user confirmation. The workflow `step.waitForEvent("agent.tool.approved", { id: toolCallId })` until the user clicks confirm or cancel in the UI.

`risk` is declared on each tool. Adding a tool without a risk classification fails the build.

### 7. Cost guardrails

Three layers of enforcement, all at the `step.run("plan-and-stream")` boundary:

1. **Per-turn cap** — see §3. Stops runaway loops within a single turn.
2. **Per-workspace daily cap** — see §3. Stops runaway daily spend.
3. **Per-user rolling-hour cap** — `$5/hour` MVP default, prevents one user burning the workspace's budget. Configurable.

All three caps surface in the `/superadmin` agent dashboard with current consumption, top-spending workspaces, and outliers (e.g. one user 10× the workspace median).

Langfuse traces include cost; the dashboard aggregates from there. We do not roll our own cost tracker.

### 8. Evals & quality gates

`packages/agent/evals/` shape:

```
evals/
├── suites/
│   ├── reconciliation/        # ~10 golden tasks: link unlinked sales, fix stuck commissions
│   ├── commission-questions/  # ~10 tasks: "what did rep X earn last month and why"
│   ├── coaching/              # ~10 tasks: "find calls where rep handled price objection well"
│   └── refusals/              # ~10 tasks: things the agent must REFUSE (cross-workspace, bypass authz, mass deletes)
├── scorers/
│   ├── tool-call-exact.ts     # exact-match on tool name + key args
│   ├── llm-judge.ts           # structured rubric, judged by Sonnet 4.6
│   └── side-effect.ts         # checks DB state after run
└── runner.ts                  # Inngest scheduled function, runs nightly + on-demand
```

**Refusal suite is mandatory.** It tests that the agent refuses to: act outside the calling user's workspace, bypass authorization, leak data across tenants, mass-mutate without approval, send external messages without user consent. A regression on the refusal suite is a CI block at any threshold.

CI gates: every PR that touches `packages/agent/` runs the eval suite. Regression > 5% on functional suites = block. Any regression on refusal suite = block.

The eval dashboard lives at `/superadmin/agent/evals` and shows score timeseries, regressions, cost-per-eval-run, and a diff view comparing two runs at the trace level.

### 9. Safety & authorization

The principles in [§7.6](../ARCHITECTURE.md) are operationalized here:

- **The agent acts as the calling user.** The Inngest workflow context carries the user's identity, access_role, sales_roles, workspace_id, sub_account_id. Tool authz resolves against this context.
- **There is no "agent role" with elevated access.** Cross-workspace access requires `superadmin`, which is a human-only role.
- **Risky actions require explicit approval.** Defined by tool `risk` field (§6).
- **The agent cannot grant itself permissions.** Permission-mutating tools (`grantRole`, `removeMembership`, `editCommissionRule`) are `risk: "high"` and additionally rejected by tool authz unless the calling user is `workspace_admin` or higher.
- **The agent cannot send external messages without user-message-level confirmation.** Email, SMS, customer-facing webhooks are all gated.
- **Every tool execution writes `audit_log` with `actor_kind: "agent_on_behalf_of_user"`.** Audit views distinguish human actions from agent actions.

### 10. Multi-agent shape

**One agent, parallelized via workflows.** No specialized "commission agent" vs "coaching agent" personas. One agent has the full tool surface, scoped per turn to the user's permissions.

For parallelizable tasks ("review my last 50 calls and identify patterns"), the planner emits a `parallelMap` tool call that fans out to N Haiku-driven sub-runs via Inngest's parallel step pattern. Each sub-run has its own bounded context, its own tool surface (typically read-only), and writes its result to a transient `agent_subrun_results` table that the parent agent aggregates.

This keeps the user-facing surface coherent (one agent, one persona, one thread) while allowing the system to scale to long-tail batch reasoning.

### 11. Persona configurability

Three layers:

1. **Platform default** — set in `platform_settings.agent_persona` by `superadmin`. Default name: "RevOps". Default voice: "professional, concise, never hyperbolic, never sycophantic, calls out tradeoffs, refuses gracefully."
2. **Workspace whitelabel override** — set in `tenant_settings.agent_persona` by `workspace_admin`. Customer can name the agent anything ("Cash" for a money-themed brand, "Atlas" for an analytics-themed brand) and set tone preferences.
3. **User preference (deferred to Phase 2)** — per-user verbosity preference (`brief` / `default` / `detailed`). Stored on `profiles`.

Persona is a structured field with `name`, `voice`, `forbidden_phrases`, `style_examples`. Injected into the cached system prompt block.

### 12. Failure modes

| Failure | Detection | User experience | System behavior |
|---|---|---|---|
| Claude rate-limited | 429 from API | "I'm rate-limited; retrying…" | Inngest retries with exponential backoff, max 5 attempts |
| Tool authz denied | `authorize` returns false | "I can't do that — your permission level doesn't allow it" | Logged to audit_log as `actor_kind: "agent_on_behalf_of_user", outcome: "authz_denied"` |
| Tool execution errors | `run` throws | "Something went wrong with that step. Want me to try again or different approach?" | Error captured to Sentry with workspace_id, user_id, tool_name; marked retryable or non-retryable |
| Workflow timeout (8 min) | Inngest function-level timeout | "I hit my time limit. Here's what I got done so far. Want me to continue?" | Final assistant message saved, turn closed, follow-up turn possible |
| Cost cap hit | Cost tracker | "I hit my budget for this turn. Here's what I have. Continue?" | Same as timeout — partial response saved, user can re-prompt |
| Pusher channel auth fails | Subscription error in browser | Falls back to polling `GET /api/agent/threads/:id/messages` every 2s | Telemetry alert if rate exceeds 5% of sessions |
| Eval regression in production | Nightly Langfuse-derived report | Internal alert | `superadmin` review before next deploy of agent code |

### 13. Day-one tool surface

Phase 0 ships **read-only tools only** so the agent can be exercised against real data without mutation risk:

- `searchCalls`, `searchSales`, `searchCustomers`, `searchCommissions`
- `getCallTranscript`, `getCommissionRule`, `getRepGoals`
- `getRepStats`, `getTeamLeaderboard`
- `getInbox`
- `proposeFact`, `confirmFact` (memory only)

Phase 1 ships the first wave of mutation tools:

- `linkSaleToCall`, `unlinkSaleFromCall`
- `setCallDisposition`, `setCallOutcome`
- `createTask`, `completeTask`, `snoozeTask`
- `recordFollowUp`
- `proposeCommissionLink` (suggests, doesn't approve — approval is a Phase-3 high-risk tool)

Every Phase-1 tool is `risk: "low"` or `risk: "medium"`. No high-risk tools until Phase 3.

## Alternatives considered

### Inline server-action loop instead of Inngest workflow

Tempting because it's simpler to implement. Rejected because: serverless invocations time out at ~60–300s depending on tier; agent runs can take longer; crashes lose state; retries restart the whole turn; observability requires building from scratch. Inngest gives all of this for free at the cost of one extra service we're already adopting.

### One model (Sonnet only)

Simpler routing logic. Rejected because: parallel review of 50 calls at Sonnet cost is $0.50–$2 per request; the same task at Haiku is ~$0.05 with adequate quality. Per-workspace daily caps make Sonnet-only economically infeasible at MVP. The router code is ~50 lines and pays for itself in the first week.

### Specialized agents (commission agent, coaching agent, etc.)

Cleaner mental model, more tractable evals per agent. Rejected because: users do not think in agent-domain boundaries — they ask cross-domain questions naturally ("did this commission get clawed back, and was the call on the original sale a no-show?"). Routing between agents adds latency and complexity. One agent with the full surface and per-turn permission scoping is the right shape.

### LLM-driven router (model picks its own model)

Tempting for "intelligence." Rejected because: the routing decision is bounded enough that deterministic rules suffice, and an LLM-driven router adds non-trivial latency and a self-recursion problem (which model picks the model?). The deterministic router is auditable, cheap, and ~50 lines.

### Browser-side tool execution

Faster perceived latency. Rejected because: tools mutate authoritative state and must be audited; running them in the browser breaks the audit chain, opens authz to client-side bypass, and forks the codebase between agent-callable and human-callable surfaces. All tools execute server-side, period. UI optimistic updates are a separate, allowed thing.

### Swarming / multi-agent debate

Several agents argue with each other to improve quality. Rejected for now. The eval suite is the quality mechanism. Swarming triples cost for marginal quality gains at our task complexity. Revisit if/when funded and if/when we have a class of tasks where it's measurably better.

## Consequences

### Positive

- The agent is the same surface humans use. Adding a feature in the UI gives the agent that capability for free (and vice versa). One source of truth for every domain action.
- Durable workflows mean the agent is never lost mid-thought. Crashes, deploys, and rate-limits are recoverable without user-visible failure.
- Three-tier model routing keeps costs in a tight band while preserving quality on hard tasks. Per-turn, per-user, per-workspace caps prevent runaway spend.
- The refusal eval suite catches the security regressions that would otherwise be discovered in production.
- Approval gating by tool risk means the user is never surprised by a destructive action and is never interrupted for trivial ones.
- Memory is in Postgres alongside everything else — backups, branching, and queryability come free.

### Negative

- The architecture is more elaborate than a chat-completion-with-tools loop. New contributors need to understand Inngest steps, the registry contract, the routing policy, the cost guardrails, and the eval harness. Mitigation: `docs/agent.md` walks through it; the registry helper makes the right thing the easy thing.
- Pusher streaming requires browser auth and a fallback path. Implemented once in `packages/realtime/`.
- Per-turn cost caps may cut off legitimate long requests for users on the MVP tier. Mitigation: the cutoff message explicitly invites continuation; paid tier raises caps 10×.

### Risks accepted

- **Eval suite quality is everything.** A weak suite means we ship regressions we don't detect. Mitigation: refusal suite is non-negotiable from Phase 0; functional suites grow with each Phase; LLM-judge scorers are themselves evaluated against human spot-checks monthly.
- **Prompt-cache hit rate dictates economics.** A 30% hit rate roughly doubles cost vs an 80% rate. Mitigation: cache-friendly system prompt structure (§5), Langfuse alert on hit-rate drop.
- **The agent's "act as the user" property depends on the `can()` policy being correct.** If we ship a buggy authz check, the agent inherits the bug. Mitigation: `packages/auth/policy.ts` is the most-tested module in the repo; integration tests cover RLS + policy together.

## Implementation notes

- `packages/agent/` skeleton lands in Phase 0 with: `defineTool` helper, the read-only tool set, the Inngest workflow shell, the memory schema, the eval runner stub, and the persona configuration.
- The Phase 0 agent is exercisable but read-only. Mutation tools land in Phase 1 alongside the domain modules they call.
- `docs/agent.md` is the developer-facing companion to this ADR — covers "how to add a tool", "how to write an eval", "how to debug a turn".
- Any change to the routing policy, cost caps, risk classification, or refusal suite requires a new ADR superseding the relevant section of this one.

## Related

- [ARCHITECTURE.md §1.3](../ARCHITECTURE.md) — Principle #2: agent is foundational
- [ARCHITECTURE.md §7](../ARCHITECTURE.md) — Tenancy & access control (the policy the agent inherits)
- [ARCHITECTURE.md §8](../ARCHITECTURE.md) — Agent architecture overview (this ADR is the locked detail)
- ADR-0001 — Tech stack (Inngest, Claude, Langfuse, pgvector all locked there)
- ADR-0002 — Role topology (the agent reads workspace `sales_roles` for vocabulary and permissions)
