# RevOps Pro — Architecture

> **Status:** Draft v0.2 · Locked decisions, open implementation
> **Audience:** Founders, future engineers, and the AI agents that will help build this
> **Predecessor:** [C2C Tracker](../old-app-teardown.md) — referenced throughout as "the old app"

---

## 1. Product & Principles

### 1.1 What RevOps Pro is

RevOps Pro is a B2B SaaS revenue-operations platform for high-ticket sales teams. It unifies appointment tracking, sales reconciliation, commission automation, gamification, and an **AI agent that operates the system on behalf of the user**.

The product spans three audiences inside one workspace:

- **Reps** — log calls, see earnings in real time, get AI-driven daily briefings, clear an inbox of tasks.
- **Managers** — oversee team performance, set goals, run leaderboards, approve commissions.
- **Ops admins** — wire integrations, configure commission rules, reconcile sales, run payouts.

### 1.2 Why a rewrite (not a refactor)

The old app was a Lovable-originated React/Vite + Supabase MVP. It is feature-rich but architecturally fragile:

- 3,000+ line god components and hooks
- Hash-based routing, no deep linking
- 50+ `as any` type casts, TypeScript not in strict mode
- 1 test file in the entire repo
- Wildcard CORS on all 55 edge functions
- Webhook signatures unvalidated; OAuth tokens stored plaintext
- No background-job system; webhook delivery hand-rolled in a Postgres table
- AI agent is a feature-flagged-off chat box, not a true operator
- No observability stack despite Sentry being installed

These are not refactor-shaped problems. They are foundation-shaped problems. RevOps Pro is a clean-slate rebuild that preserves the **product strategy, domain model, design language, and copy** of the old app, and replaces everything else.

### 1.3 Principles

1. **Type safety end-to-end.** Strict TypeScript. Zod at every boundary. No `any`. The compiler is a load-bearing teammate.
2. **The agent is foundational, not a bolt-on.** Every domain action is exposed as a typed tool the agent can call. Humans and the agent use the same surface.
3. **Durable by default.** Webhooks, integrations, and multi-step workflows run inside Inngest. Nothing important lives in a 30-second serverless invocation that can disappear mid-flight.
4. **Postgres is the source of truth.** Multi-tenancy, RLS, audit trails, semantic memory (pgvector) all live in one database. We do not split state across services we don't need.
5. **Free-tier first, escape hatches always.** The MVP runs at near-zero cost. Every paid service has a self-host or swap path documented up front.
6. **No god components, no god hooks.** A file over ~400 lines is a code smell. Domain logic lives in `packages/`, not in pages.
7. **Test the contracts, not the implementation.** We test the agent's tool surface, the webhook handlers, the commission engine, and the auth boundary. We do not chase 100% coverage on UI.
8. **Observability from day one.** Sentry, Axiom, Langfuse wired before the second feature ships.
9. **Brand and copy are configuration, not code.** The product name "RevOps Pro" is a runtime setting, not a hardcoded string.
10. **Flexibility over opinionation.** The product fits the team — not the other way around. Sales roles, funnel stages, dispositions, and commission models are workspace-configured, not hardcoded. We ship sensible presets (Solo, Setter+Closer, Setter+Closer+CX, Custom) but a workspace can define any role topology that maps to its business. A solo coach with one-sale-one-rep gets a simple UI; a 50-person agency with setter→closer→CX gets the full machine. Same data model, same code.

---

## 2. Brand & Runtime Configuration

The product name, logo, primary color, support email, and marketing copy live in a `tenant_settings` table and a `platform_settings` table:

- `platform_settings` — global, editable only by superadmins. Holds the **product brand** ("RevOps Pro" today), default theme, default email-from address, feature flags by environment.
- `tenant_settings` — per-workspace whitelabel overrides (logo, accent color, support email). Off by default.

A superadmin dashboard at `/superadmin` (gated by a `superadmin` role on `platform_users`, separate from tenant access) edits these. The `<Brand />` component reads the platform setting at render time. There is no `BRAND_NAME` constant anywhere in the codebase. Renaming the product is a database UPDATE.

This pattern extends to: support URLs, terms-of-service text, default email templates, default commission rule presets, and AI agent persona name.

---

## 3. System Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              CLIENT                                      │
│  Next.js 15 (App Router) · React Server Components · Server Actions      │
│  Vercel AI SDK streaming · Tremor + Recharts · Tailwind + shadcn         │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │  RSC · Server Actions · tRPC (typed RPC)
┌──────────────────────────▼───────────────────────────────────────────────┐
│                        APPLICATION LAYER                                 │
│  Next.js route handlers · Server Actions · tRPC routers                  │
│  Better Auth session · Org-scoped middleware · Permission guards         │
└──────┬──────────────────────────┬─────────────────────────────┬──────────┘
       │ reads/writes             │ enqueue                     │ stream
┌──────▼──────────┐    ┌──────────▼──────────┐      ┌───────────▼─────────┐
│   POSTGRES      │    │      INNGEST        │      │   CLAUDE API        │
│   (Neon)        │    │  Durable workflows  │      │   Sonnet 4.6 / Opus │
│                 │◄───┤  Webhooks · Cron    │      │   4.7 · prompt      │
│  • App data     │    │  Agent steps        │      │   caching           │
│  • pgvector     │    │  Retries · DLQ      │      └─────────────────────┘
│  • Audit log    │    └─────────┬───────────┘
│  • RLS policies │              │ tool calls
└──────┬──────────┘              ▼
       │              ┌────────────────────────┐
       │              │   AGENT TOOL REGISTRY  │
       │              │   (typed, scoped)      │
       │              └────────────────────────┘
       │
┌──────▼──────────┐  ┌────────────────┐  ┌──────────────┐  ┌─────────────┐
│ INTEGRATIONS    │  │   PUSHER       │  │   RESEND     │  │   STRIPE    │
│ GHL · Whop      │  │   Realtime     │  │   Email      │  │   Billing   │
│ Stripe · Type-  │  │                │  │              │  │             │
│ form · JotForm  │  └────────────────┘  └──────────────┘  └─────────────┘
└─────────────────┘

Observability layer (cross-cutting):
  Sentry (errors) · Axiom (logs/APM) · PostHog (product) · Langfuse (LLM)
```

**Key architectural decisions:**

- **No separate API server.** Next.js route handlers + Server Actions + tRPC cover the API surface. If we ever need a dedicated API (mobile, public API), `packages/api` is structured to be extracted to a Hono server with no rewrite.
- **Inngest is the spine for everything async.** Inbound webhooks, scheduled jobs, retries, agent multi-step workflows, outbound webhook delivery to customers. The old app's homegrown delivery table is dead.
- **The agent runs server-side, not in the browser.** The browser streams the conversation; tool execution happens in Inngest steps with full audit and retry semantics.

---

## 4. Tech Stack (Locked)

| Layer | Pick | Free-tier path | Funded path |
|---|---|---|---|
| Frontend framework | Next.js 15 | Vercel Hobby | Vercel Pro |
| UI primitives | shadcn/ui + Tailwind | — | — |
| Charts | Tremor + Recharts | — | — |
| Animation | Framer Motion | — | — |
| Database | Postgres on Neon | 0.5 GB + branching | Neon Scale |
| ORM | Drizzle | OSS | OSS |
| Auth | Better Auth | OSS, runs on Neon | Clerk if SSO/SCIM needed |
| Jobs / workflows | Inngest | 50k runs/mo | Inngest paid |
| Realtime | Pusher Channels | 200k msg/day | Ably or Pusher paid |
| AI brain | Claude (Sonnet 4.6 / Opus 4.7) | Pay per token | same |
| AI orchestration | Vercel AI SDK + Inngest | OSS + Inngest | same |
| Vector / RAG | pgvector on Neon | Free, in-DB | same |
| LLM observability | Langfuse | 50k traces/mo | Self-host on Fly |
| Errors | Sentry | 5k/mo | Sentry Team |
| Logs / APM | Axiom | 0.5 TB/mo | same |
| Product analytics + flags | PostHog Cloud | 1M events/mo | self-host |
| Email | Resend | 3k/mo | Resend paid |
| Outbound webhooks | Inngest at MVP | covered | Svix at scale |
| Billing | Stripe Billing | % only | same |
| File storage | Cloudflare R2 | 10 GB + zero egress | same |
| Testing | Vitest + Playwright + Storybook | OSS | OSS |
| Repo | Turborepo + pnpm | OSS | OSS |
| Type-safe RPC | tRPC | OSS | OSS |
| Validation | Zod | OSS | OSS |
| Date/time | Temporal API polyfill / date-fns | OSS | OSS |
| Forms | React Hook Form + Zod | OSS | OSS |

**Estimated MVP run cost:** $0–$20/mo plus Claude API tokens (variable, ~$5–$50/mo at MVP usage).

---

## 5. Repository Structure

A pnpm + Turborepo monorepo. Mobile lands later as a sibling app under `apps/`.

```
revops/
├── apps/
│   └── web/                          # Next.js 15 (App Router)
│       ├── app/
│       │   ├── (marketing)/          # Public pages
│       │   ├── (auth)/               # Sign-in, sign-up, magic-link
│       │   ├── (app)/                # Authenticated app shell
│       │   │   ├── [workspace]/      # Workspace-scoped routes
│       │   │   │   ├── dashboard/
│       │   │   │   ├── calls/
│       │   │   │   ├── sales/
│       │   │   │   ├── commissions/
│       │   │   │   ├── goals/
│       │   │   │   ├── inbox/
│       │   │   │   ├── integrations/
│       │   │   │   ├── analytics/
│       │   │   │   ├── settings/
│       │   │   │   └── agent/        # Agent chat surface
│       │   │   └── layout.tsx
│       │   ├── superadmin/           # Platform-level admin
│       │   ├── api/
│       │   │   ├── trpc/[trpc]/      # tRPC handler
│       │   │   ├── inngest/          # Inngest webhook entry
│       │   │   ├── webhooks/         # Inbound integration webhooks
│       │   │   │   ├── ghl/
│       │   │   │   ├── whop/
│       │   │   │   ├── stripe/
│       │   │   │   ├── typeform/
│       │   │   │   └── jotform/
│       │   │   └── auth/[...all]/    # Better Auth handler
│       │   └── layout.tsx
│       └── components/               # App-specific composition only
│
├── packages/
│   ├── db/                           # Drizzle schema, migrations, seed
│   │   ├── schema/                   # One file per domain
│   │   ├── migrations/
│   │   └── client.ts
│   ├── auth/                         # Better Auth config, helpers
│   ├── agent/                        # AI core
│   │   ├── tools/                    # Typed tool registry per domain
│   │   ├── memory/                   # Conversation + semantic memory
│   │   ├── prompts/                  # System prompts, persona
│   │   ├── evals/                    # Golden tasks, scorers
│   │   └── runtime.ts                # Inngest agent loop
│   ├── jobs/                         # Inngest functions
│   │   ├── webhooks/                 # Per-integration handlers
│   │   ├── schedules/                # Cron jobs
│   │   ├── workflows/                # Multi-step business workflows
│   │   └── outbound/                 # Customer-facing webhook delivery
│   ├── integrations/                 # Typed clients
│   │   ├── ghl/
│   │   ├── whop/
│   │   ├── stripe/
│   │   ├── typeform/
│   │   ├── jotform/
│   │   └── shared/                   # OAuth helpers, signature verify
│   ├── domain/                       # Pure business logic
│   │   ├── commissions/              # Rules engine, payouts, clawback
│   │   ├── calls/
│   │   ├── sales/
│   │   ├── goals/
│   │   └── reconciliation/
│   ├── ui/                           # Design system (RN-friendly primitives)
│   ├── trpc/                         # Routers, context, middleware
│   ├── config/                       # Env schema, feature flags, brand
│   └── tooling/                      # tsconfig, eslint, tailwind preset
│
├── docs/
│   ├── ARCHITECTURE.md               # This file
│   ├── adr/                          # Architecture Decision Records
│   ├── domain-model.md
│   ├── agent.md
│   ├── runbook.md
│   └── glossary.md
│
├── .env.example
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

**Boundary rules:**

- Pages and route handlers do not contain business logic. They call into `packages/domain/*` or `packages/agent/*`.
- `packages/domain` is framework-agnostic and tested in isolation.
- `packages/integrations` only contains typed clients and signature verification — no business logic.
- `packages/jobs` orchestrates; it composes `domain` and `integrations`.
- `packages/ui` exports primitives that work in React (web) and React Native (when mobile lands). No DOM-specific APIs in ui primitives.

---

## 6. Domain Model

The data model evolves the old app's schema, fixes its smells (no transactions, denormalized statuses, missing indexes, hard deletes), and adds three foundational concepts the old app missed: **configurable role topology, multi-party commissions, and a first-class funnel-events stream**. Every model decision below is shaped by the principle in §1.3 #10: flexibility over opinionation. A solo seller and a 50-person multi-role team use the same tables — what differs is configuration.

### 6.1 Top-level shape

```
platform_users      ─── superadmins, separate from tenant users
                        │
workspaces          ─── tenant root (the customer account)
  ├── workspace_settings    ─── role topology, funnel preset, comp model
  ├── sales_roles           ─── workspace-defined: setter, closer, cx, AE...
  ├── funnel_stages         ─── workspace-defined: optin → booked → ... → collected
  ├── dispositions          ─── workspace-defined call/sale outcomes
  ├── commission_rules      ─── versioned, reference sales_roles
  ├── commission_periods
  └── sub_accounts          ─── teams/locations within a workspace
        ├── memberships     ─── user ↔ sub_account ↔ access_role
        ├── sales_role_assignments ─── user ↔ sales_role(s) ↔ sub_account
        ├── data_sources
        │     └── data_source_connections ─── per-tool OAuth/API creds
        ├── customers       ─── persists post-sale; status churn/active/refunded
        ├── calls
        │     ├── disposition_id
        │     ├── recording_consent
        │     ├── recordings (URLs, transcripts → pgvector)
        │     └── linked_sale_id
        ├── sales
        │     ├── customer_id
        │     ├── payment_plan_id
        │     ├── commission_recipients[]   ─── multi-party
        │     ├── refund_status, original_sale_id
        │     └── booked_amount vs collected_amount
        ├── payment_plans
        │     └── payment_plan_installments  ─── per-installment ledger
        ├── commission_entries  ─── ledger; references installment + role
        ├── funnel_events      ─── append-only event stream
        ├── goals              ─── OTE / quota / ramp / target
        ├── tasks              ─── the inbox
        ├── applications, optins ─── form captures
        ├── audit_log          ─── append-only, queryable
        └── outbound_webhook_subscriptions
```

### 6.2 Schema rules (universal)

- **Every table has** `id` (uuid), `created_at`, `updated_at`, `created_by`, `workspace_id`, and `sub_account_id` where applicable.
- **Soft deletes via `deleted_at`** on entities with referential history (calls, sales, customers, commission_entries). Hard deletes only for derived data.
- **Audit log is append-only.** Every mutation through the agent or a Server Action writes a row.
- **Money is `numeric(14,2)` with explicit `currency` column.** No floats. Currency stored, not assumed.
- **Time-zones stored alongside times.** Every `*_at` column has a paired `*_at_tz` or the value is stored UTC and the entity carries a `timezone`. Dashboards render in the viewer's tz.
- **Idempotency keys on every webhook intake.** `(source, external_id)` unique constraint prevents duplicates.
- **Foreign keys everywhere.** No string IDs masquerading as references.
- **Indexes ship with the migration that introduces the query path.** No "we'll add the index later" — the index is part of the feature.

### 6.3 Role topology (configurable)

The old app baked "rep" into every table. RevOps Pro splits two concepts:

- **`access_role`** — what a user can do in the app (admin, manager, contributor, viewer). Platform-defined, fixed enum. See §7.
- **`sales_role`** — what a user does in the sales process (setter, closer, cx, AE, BDR…). **Workspace-defined**, with built-in presets.

```
sales_roles
├── id, workspace_id
├── slug ("setter" | "closer" | "cx" | custom)
├── label ("Setter", "Closer", "Customer Success")
├── stage_ownership[]   ─── which funnel stages this role drives
├── default_commission_share  ─── for sale-level multi-party math
└── deleted_at
```

A workspace picks a topology preset on setup:

| Preset | Roles | Default split | Use case |
|---|---|---|---|
| **Solo** | one role: `seller` | 100% | Solo coach, single-rep agency |
| **Setter + Closer** | `setter`, `closer` | 20% / 80% | Most high-ticket sales teams |
| **Setter + Closer + CX** | `setter`, `closer`, `cx` | 15% / 70% / 15% | Teams with retention-tied CX |
| **Custom** | user-defined | user-defined | Anything else |

Presets are seeded into `sales_roles`. Splits are defaults — actual rules live in `commission_rules` and can be arbitrarily complex (per-product, per-source, per-tier).

A user can hold multiple sales roles. A manager who also closes deals has `access_role=manager` and `sales_roles=[closer]`. A pure ops admin has `access_role=workspace_admin` and no sales roles. CX team members have `sales_roles=[cx]` and operate post-sale.

### 6.4 Multi-party commission engine

Every sale carries a `commission_recipients[]` array — one row per party with `user_id`, `sales_role_id`, `share_pct`, `computed_amount`, `rule_version_id`, `status`. The engine:

1. Looks up the workspace's commission rules for the sale's product/source/period.
2. For each `sales_role` referenced by the rules, finds the user(s) assigned to that role for the relevant `(sub_account, time, customer)` slice.
3. Computes per-recipient amount inside a Postgres transaction wrapped by an Inngest workflow.
4. Writes one `commission_entry` per recipient, each linked to the **payment_plan_installment** (not the sale) — so cash-collected commissions only fire as installments collect.
5. Stores the rule version + inputs in `computed_from` JSON for audit and recompute.

Three additions over the old app:

- **Multi-party from day one.** Setter+closer+cx splits are first-class, not a bolt-on.
- **Hold periods.** Commission entries have `pending_until`, `available_at`, `paid_at` — three states. Default hold is 30 days, configurable per workspace, configurable per product.
- **Versioned rules.** Mid-period rule changes don't retroactively rewrite history; entries reference the rule version that produced them.

### 6.5 Funnel stages and events (configurable)

The old app collapsed the funnel into "calls" and "sales". RevOps Pro stores the funnel as configuration plus an event stream.

```
funnel_stages              funnel_events
├── id                     ├── id
├── workspace_id           ├── workspace_id
├── slug                   ├── sub_account_id
├── label                  ├── entity_type ("optin"|"call"|"sale"|"customer")
├── ordinal                ├── entity_id
├── kind ("lead"|"call"    ├── stage_id
│         |"sale"|"post")  ├── occurred_at
└── deleted_at             ├── source_event_id  ─── where it came from
                           └── meta jsonb
```

Default stages for the **Setter+Closer** preset:
`optin → contacted → booked → showed → pitched → closed → collected → churned/refunded`

Workspaces can add, remove, or rename stages. Events are append-only — the same entity progresses through stages by emitting events, not by mutating a status column. This makes speed-to-lead, show-up, pitch, close, and collection rates all expressible as the same query shape: time between events of two stages over a cohort.

### 6.6 Dispositions (configurable)

Workspace-configured taxonomy for *why* a call/sale ended a particular way. Examples: `not_qualified`, `price_objection`, `timing`, `decision_maker_absent`, `competitor`, `not_interested`. Each disposition belongs to a category (`positive`, `objection`, `disqualification`) so dashboards can group without recomputing per workspace. Used by analytics, by coaching surfaces, and by the agent's pattern detection.

### 6.7 Customers (post-sale)

The old app stopped at the sale. CX work and retention require the customer to persist.

```
customers
├── id, workspace_id, sub_account_id
├── primary_email, name, phone
├── status ("active"|"churned"|"refunded"|"won_back")
├── lifetime_value (computed)
├── original_sale_id    ─── first purchase
├── attributed_setter_user_id
├── attributed_closer_user_id
├── attributed_cx_user_id
├── churn_at, churn_reason
└── deleted_at
```

Post-sale events (renewal, churn, expansion) write `funnel_events` and may trigger CX-role commissions per the rule engine. The CX role exists to be paid for outcomes — retention or save — that materialize weeks/months after the sale. The hold period and installment ledger make this safe.

### 6.8 Goals — OTE / quota / ramp

The old app had flat targets. The new shape:

```
goals
├── id, workspace_id, sub_account_id
├── user_id, sales_role_id  ─── optional
├── kind ("ote"|"quota"|"ramp"|"target")
├── metric ("commission"|"closes"|"calls"|...)
├── target_value, currency
├── period_kind ("daily"|"weekly"|"monthly"|"quarterly"|"annual"|"ramp_window")
├── period_start, period_end
├── accelerators jsonb  ─── e.g. > 100% attainment = 1.5x rate
└── deleted_at
```

Ramp goals are time-bounded reduced quotas for new hires. Accelerators encode "above-100%" math that real comp plans use.

### 6.9 The inbox

A single `tasks` table surfaces:

- Calls awaiting outcome
- Sales awaiting reconciliation
- Follow-ups due (with speed-to-lead SLAs)
- No-show recovery actions
- Commissions awaiting approval
- Refund-save flow tasks (CX queue)
- Agent-generated suggestions ("This sale looks like it should link to call #482")
- Manager 1:1 prep cards

Tasks have `kind`, `payload`, `due_at`, `status`, `assigned_user_id`, `sales_role_id`, `agent_origin_id`. The inbox is the same surface for humans and agent — filtered by access_role (only managers see commission approvals) and sales_role (only CX sees save-flow tasks).

### 6.10 What's deferred but model-ready

These are not in MVP UI but the data model accommodates them with no migrations:

- Forecasting (probability-weighted pipeline) — derives from `funnel_events` + per-stage conversion rates.
- Marketing attribution — `funnel_events` carry `source_event_id`; UTM/campaign data attaches at optin.
- Multi-currency UI — schema already stores currency per row.
- Approval workflows — `commission_entries.status` machine + a generic `approvals` table will be added in Phase 4.
- Bulk operations — Postgres + Drizzle handle this fine; surface comes when load justifies it.

---

## 7. Tenancy & Access Control

### 7.1 Hierarchy

`platform → workspace → sub_account → user`. A user's access is defined by rows in `memberships(user_id, sub_account_id, access_role)`. Workspace-level access derives from membership in any sub_account in that workspace.

### 7.2 Two role concepts (split)

Most CRMs and commission tools conflate "what you can do in the app" with "what you do in the sales process." That conflation is why the old app couldn't model setter/closer/CX without rewriting half the schema. RevOps Pro splits them cleanly:

| Concept | Defined by | Examples | Used for |
|---|---|---|---|
| **`access_role`** | Platform (fixed enum) | `workspace_admin`, `sub_account_admin`, `manager`, `contributor`, `viewer` | Authorization. What UI/data/actions a user can see and perform. |
| **`sales_role`** | Workspace (configurable) | `setter`, `closer`, `cx`, plus custom | Business logic. Funnel-stage ownership, commission allocation, leaderboard grouping. |

A user has exactly one `access_role` per sub_account membership, and zero or more `sales_role` assignments. They are independent dimensions:

- Pure ops admin: `access_role=workspace_admin`, no `sales_roles`
- Player-coach manager: `access_role=manager`, `sales_roles=[closer]`
- New rep onboarding: `access_role=contributor`, `sales_roles=[setter]`
- CX team member: `access_role=contributor`, `sales_roles=[cx]`
- Solo founder: `access_role=workspace_admin`, `sales_roles=[seller]` (Solo preset)

### 7.3 Access roles (fixed)

| Role | Scope | Capabilities |
|---|---|---|
| `superadmin` | Platform | Edits `platform_settings`. Sees all workspaces. Lives on `platform_users`, never on tenant tables. |
| `workspace_admin` | Workspace | Full control inside a workspace: integrations, role topology, comp rules, billing, team. |
| `sub_account_admin` | One sub_account | Full control inside one sub_account: members, integrations, comp rules scoped to that sub. |
| `manager` | Sub_account | Read all team data, approve commissions, set goals, run 1:1 reviews. Cannot edit integrations or comp rules. |
| `contributor` | Sub_account | Default for sales roles. Owns/edits their own calls, sales, follow-ups. Reads team leaderboards. |
| `viewer` | Sub_account | Read-only. Useful for finance, exec stakeholders, auditors. |

The agent persona ("RevOps Pro Agent") is **not** an access role. The agent runs under whichever user invoked it.

### 7.4 Sales roles (workspace-configured)

Sales roles are rows in `sales_roles` per workspace. Each carries:

- `slug` — stable identifier (`setter`, `closer`, `cx`, or custom)
- `label` — display name
- `stage_ownership[]` — which `funnel_stages` this role drives (e.g. `closer` owns `pitched → closed`)
- `default_commission_share` — used when commission rules don't specify
- `default_sla` — speed-to-action targets (e.g. setter SLA: 5 minutes from optin to first call)

Workspaces create them via the topology preset on setup (Solo / Setter+Closer / Setter+Closer+CX / Custom) and can edit anytime. Editing a sales_role does not retroactively rewrite history — `commission_entries` reference the role version that produced them.

### 7.5 Enforcement

Two layers, both required:

1. **Postgres RLS** for defense in depth. Every tenant table has a `workspace_id` + `sub_account_id` filter policy keyed off `current_setting('app.current_user_id')` and `app.current_workspace_id`. The Drizzle client sets these per request.
2. **Application guards** in tRPC middleware and Server Actions, expressed as a typed `can(user, action, resource)` function in `packages/auth/policy.ts`. Permissions are derived from `access_role`. Sales-role-based filtering (e.g. "CX only sees CX queue tasks") is layered on top in the query, not in authz.

The old app had RLS but inconsistent application-layer enforcement. We do both, every time, with the same `can()` function used by routes, server actions, tRPC, and the agent.

### 7.6 The agent acts as a user

When the agent calls a tool, it runs under the user's identity, their `access_role`, and their `sales_role` assignments. There is no "agent role" with elevated access. The agent cannot do anything the user cannot do. The agent cannot promote itself, cannot read other workspaces, cannot approve its own commissions.

This is non-negotiable. It is the difference between an agent that customers trust and an agent that becomes a security incident.

---

## 8. AI Agent Architecture

### 8.1 What "elite" means here

The agent is not a chat box. It is an operator that:

- Reads the user's data (calls, sales, commissions, goals, transcripts) via RAG
- Takes real actions through a typed tool registry (link this sale, approve this commission, schedule this follow-up)
- Runs multi-step workflows that survive crashes and timeouts (Inngest steps)
- Streams its reasoning and tool calls transparently to the user
- Remembers conversations and develops semantic memory of each workspace
- Has an eval harness from day one — golden tasks, regression dashboard, cost/latency tracking

### 8.2 Architecture

```
USER MESSAGE
    │
    ▼
[Next.js Server Action] ──► Persist user turn → start Inngest workflow
                                                     │
                                                     ▼
                                          [agent.run workflow]
                                                     │
                                  ┌──────────────────┼──────────────────┐
                                  ▼                  ▼                  ▼
                           load context        plan + reason      stream output
                          (memory + RAG)       (Claude call)       (Pusher chan)
                                  │                  │
                                  └────────┬─────────┘
                                           ▼
                                   tool call requested?
                                       │       │
                                      yes      no  ──► finalize, write turn
                                       │
                                       ▼
                            [Inngest step.run("tool")]
                                       │
                                       ▼
                              tool function (typed, scoped)
                              - validates with Zod
                              - runs through authz guard
                              - writes audit_log row
                              - returns typed result
                                       │
                                       └──► loop back to Claude with result
```

### 8.3 Tool registry

Tools live in `packages/agent/tools/<domain>/<tool>.ts`. Each tool exports:

```ts
export const linkSaleToCall = defineTool({
  name: "linkSaleToCall",
  description: "Link a sale to its originating call. Call this when reconciling unlinked sales.",
  input: z.object({ saleId: z.string().uuid(), callId: z.string().uuid() }),
  output: z.object({ linkedAt: z.string() }),
  authorize: ({ ctx, input }) => can(ctx.user, "sale:update", input.saleId),
  run: async ({ ctx, input }) => domain.sales.linkToCall(ctx, input),
});
```

The same `defineTool` function feeds: the Anthropic tool-use schema, the tRPC router (so the UI can call it directly), and the test suite. One source of truth.

### 8.4 Memory

Three layers in Postgres:

1. **Turn-by-turn conversation history** — `agent_messages` table, scoped to user + thread.
2. **Per-thread summaries** — rolling summaries written by a cheap model after every N turns to keep context windows manageable.
3. **Semantic memory** — `agent_facts` table with pgvector embeddings. Workspace-scoped facts the agent has learned ("Acme Corp's commission rules use a 90-day clawback window"). Retrieved on every turn via similarity search.

### 8.5 Evals

`packages/agent/evals/`:

- **Golden tasks** — JSON files describing scenarios with expected tool calls and outcomes.
- **Scorers** — exact-match for tool calls, LLM-as-judge for free-form responses.
- **Runner** — Inngest scheduled function runs the suite nightly, writes scores to `agent_eval_runs`.
- **Dashboard** — superadmin route that visualizes regression over time.

Every prompt change and every model swap reruns evals before merge. CI gates on regression > threshold.

### 8.6 Observability

Every Claude call goes through Langfuse with: prompt, response, tool calls, latency, token cost, eval score. The superadmin agent dashboard surfaces slowest threads, most expensive workspaces, failed tool calls.

### 8.7 Models and routing

- **Default reasoning:** Claude Sonnet 4.6 — fast, cheap, capable of tool use.
- **Hard reasoning:** Claude Opus 4.7 — invoked when the planner detects ambiguity or when the user explicitly requests "deep mode".
- **Summarization / cheap tasks:** Claude Haiku 4.5.
- Routing is a function in `packages/agent/runtime.ts` based on task complexity, not a hardcoded model per surface.
- **Prompt caching** is on for system prompts and tool definitions. Expected cache hit rate target: > 80%.

---

## 9. Integrations & Webhooks

### 9.1 Pattern

Every external integration follows the same shape:

```
packages/integrations/<name>/
  client.ts          # typed API client
  oauth.ts           # OAuth flow (if applicable)
  signature.ts       # webhook signature verification
  types.ts           # response types (Zod)
  events.ts          # event types we care about

apps/web/app/api/webhooks/<name>/route.ts
  → verify signature
  → ack 200 immediately
  → enqueue Inngest event with raw payload + headers

packages/jobs/webhooks/<name>.ts
  → idempotency check (source + external_id)
  → parse with Zod
  → call domain logic
  → write audit_log row
```

### 9.2 Day-one integrations

- **GoHighLevel** — OAuth, bidirectional appointment + opportunity sync (the old app did one direction).
- **Whop** — OAuth + PKCE, sales webhook, refund webhook with commission clawback.
- **Stripe** — Stripe Billing for our own SaaS subscription, plus a Stripe payment-processor integration for customers using Stripe.
- **Typeform / JotForm** — webhook-based form capture, field mapping UI ported from old app.
- **Fathom** — call recording webhook, transcript ingest into pgvector for agent RAG.

### 9.3 Outbound webhooks

Customers can subscribe to events from their workspace. MVP: Inngest functions deliver with retry. When delivery volume justifies it, swap to Svix — the subscription model is shaped to match Svix's API so the swap is hours, not days.

### 9.4 Token storage

OAuth tokens encrypted at rest using `pgcrypto` with a key from `KMS_KEY_ID` env var. Refresh handled in a single Inngest function with a Postgres advisory lock to prevent the race the old app had.

---

## 10. Background Jobs & Workflows (Inngest)

Inngest replaces three things from the old stack: edge functions for async work, the homegrown `outbound_webhook_deliveries` table, and any cron we'd otherwise wire to Vercel.

### 10.1 Function categories

- **Webhooks** — one function per integration intake. Idempotent.
- **Schedules** — nightly evals, daily digest emails, period-close jobs, token refresh sweeps.
- **Workflows** — multi-step business processes: commission period close, refund cascade, agent runs, reconciliation suggestions.
- **Outbound** — customer webhook delivery with retry/backoff.

### 10.2 Conventions

- Every function declares an `idempotency` key.
- Every step writes to `audit_log` if it mutates state.
- Errors with retryable status throw; non-retryable errors return a `NonRetriableError`.
- Long workflows checkpoint via `step.run` so resumption is automatic.

---

## 11. Realtime

Pusher Channels for:

- Live commission updates ("you just earned $X" toast)
- Leaderboard updates
- Agent message streaming (alternative: SSE via the AI SDK; we use Pusher when the agent runs durably in Inngest and needs to stream from a non-request context)
- Inbox badge counts

Channels are workspace-scoped: `presence-workspace-<id>-rep-<id>`. Auth via Pusher's auth endpoint, gated by Better Auth session and membership check.

---

## 12. Configuration, Secrets, Environments

### 12.1 Environment schema

All env vars validated at boot via `packages/config/env.ts` (Zod). The app refuses to start with missing or malformed envs. Surfaces:

- `apps/web` (Next.js)
- `packages/jobs` (Inngest functions, when deployed via Inngest cloud)
- Local dev (`.env.local`)

### 12.2 Environments

- **dev** — local, against a Neon dev branch
- **preview** — every PR gets a Vercel preview + a Neon branch (auto-created via Neon's Vercel integration)
- **prod** — `main` branch

### 12.3 Secrets

- **Vercel env vars** for the web app
- **Inngest env vars** for jobs
- **Doppler or 1Password** as the source of truth that syncs to both. (Decision deferred to first integration.)

### 12.4 Feature flags

PostHog feature flags. Brand/copy live in the database, not flags — flags are for code paths.

---

## 13. Observability, Security, Compliance

### 13.1 Observability stack

| Concern | Tool |
|---|---|
| Errors (frontend + backend) | Sentry |
| Structured logs + APM | Axiom |
| Product analytics + session replay | PostHog |
| LLM tracing | Langfuse |
| Uptime / synthetic | BetterStack free tier |

Every server action and tRPC call emits a structured log with `userId`, `workspaceId`, `traceId`. Errors include the same trace ID; Sentry and Axiom are correlated.

### 13.2 Security posture

- **CORS** — strict allowlist per route. No wildcard, ever.
- **Webhook signatures** — verified at the route handler before enqueueing. Rejected webhooks logged but not retried.
- **Token storage** — encrypted at rest, decrypted only in Inngest steps that need to call the integration.
- **Rate limiting** — Upstash Redis (free tier) on auth, agent, and webhook routes.
- **Input validation** — Zod at every external boundary (HTTP, webhooks, agent tools).
- **CSP headers** — strict. No inline scripts.
- **Dependency scanning** — GitHub Dependabot + Socket.dev free tier.
- **Secrets scanning** — GitHub secret scanning enabled.

### 13.3 Compliance posture (MVP)

- **GDPR-ready data model** — soft deletes, export endpoint, audit log. Right-to-erasure as a workflow.
- **SOC 2 path** — observability and access controls in place from day one. Drata or Vanta when budget allows.
- **HIPAA** — not in scope for MVP.

---

## 14. Testing Strategy

| Layer | Tool | What we test |
|---|---|---|
| Unit | Vitest | `packages/domain/*` — commission engine, reconciliation, rules |
| Integration | Vitest + testcontainers (Postgres) | Drizzle queries, RLS policies, webhook handlers end-to-end |
| Agent | Vitest + Langfuse evals | Tool registry, planner, golden tasks |
| E2E | Playwright | Critical flows: sign-up, log a call, log a sale, see commission |
| Component | Storybook + Chromatic free tier | Design system primitives |

CI gates on: typecheck, lint, unit, integration, e2e, agent eval regression.

---

## 15. Migration Plan from the Old App

We do not import code. We do import:

1. **The data model**, hardened per Section 6.
2. **The commission engine logic**, rewritten in `packages/domain/commissions` with tests.
3. **The design language** — colors, typography, spacing — codified into `packages/ui` tokens.
4. **Copy and product strategy** from the roadmap and design docs.
5. **OAuth flow knowledge** for GHL — re-implemented, not copy-pasted.
6. **The form field-mapping pattern** from `optin/application/ghl_field_mappings`, generalized into one mapper.

We do not import:

- Any routing code
- Any page or hook over 200 lines
- The `outbound_webhook_deliveries` table and stored procs
- The agent chat code
- Lovable's `.lovable` directory or workflow

For existing customers (if any), a one-shot migration script lives in `packages/db/migrations/import-from-old-app.ts`. Deferred until the new app reaches feature parity for the relevant flows.

---

## 16. Phased Roadmap

The phasing below absorbs the blind-spot work into the foundation. The principle: **data-model decisions cannot be deferred — UI surfaces can.** Every entity in §6 ships in Phase 0–1 even when the surface for it lands later. Migrations are the most expensive thing to redo; we pay that cost up front.

### Phase 0 — Foundation (1–2 weeks)
- Monorepo scaffolded (Turborepo + pnpm)
- Drizzle schema covering **all** of §6: workspaces, sub_accounts, sales_roles, sales_role_assignments, funnel_stages, funnel_events, dispositions, customers, calls, sales, payment_plans, payment_plan_installments, commission_rules, commission_periods, commission_entries, goals, tasks, audit_log, agent_messages, agent_facts (pgvector)
- Role-topology presets seeded (Solo / Setter+Closer / Setter+Closer+CX / Custom)
- Better Auth with workspace/sub-account/access-role model
- Inngest + Sentry + Axiom + Langfuse wired
- Brand from `platform_settings`; superadmin route stub
- Authenticated workspace shell with onboarding wizard that picks the role topology preset

### Phase 1 — Core RevOps loop (4–6 weeks)
- Calls CRUD with disposition + recording_consent
- Sales CRUD with multi-party `commission_recipients`
- `funnel_events` emitted on every status transition
- Manual + agent-assisted call ↔ sale linking
- Multi-party commission engine (flat rate to start), installment-based, with hold periods
- Per-role dashboards (setter / closer / cx / manager)
- The inbox surface (filtered by access_role and sales_role)
- Speed-to-lead SLA on setter inbox
- Two integrations end-to-end: **GoHighLevel** (inbound appointments) + **Aircall** (auto-logged calls)
- Fathom transcript ingest → pgvector

### Phase 2 — Agent foundational + coaching (4–6 weeks, overlaps Phase 1)
- Agent tool registry covering all Phase 1 domain mutations
- Conversation memory + pgvector RAG over calls / sales / transcripts / customers
- Agent UI surface in `/[workspace]/agent`
- 10–15 golden eval tasks; nightly Inngest eval runs
- Langfuse dashboards live in `/superadmin`
- Coaching surface: per-rep call review with transcript search
- Pattern-detection agent suggestions ("close rate drops after 4pm for this rep")
- Manager 1:1 prep view

### Phase 3 — Commission depth + post-sale + integrations (6–8 weeks)
- Tiered, bonus, override, accelerator commission rules; OTE / quota / ramp goals
- Period close workflow with approval chain
- CX role workflows: refund-save flow, retention-tied commissions, churn tracking
- Customer journey post-sale (active / churned / refunded / won_back)
- Whop integration (sales + refund webhooks with installment-level clawback)
- Stripe payment-processor integration
- Typeform + JotForm (form capture with field mapping)
- Forecasting view (probability-weighted from `funnel_events`)
- Marketing-attribution UI (UTM ingestion at optin)

### Phase 4 — Launch readiness
- Native analytics dashboards with cohort comparisons (kill Metabase entirely)
- Outbound webhook subscriptions for customers
- Whitelabel `tenant_settings` UI
- Stripe Billing for our own subscription
- Bulk operations (bulk approve, bulk import, bulk update)
- Finance exports (QuickBooks / Xero) and approval workflows
- E2E coverage on golden flows
- Public marketing site

### Phase 5 — Mobile
- `apps/mobile` (Expo) using `packages/ui` primitives
- Read-first, then write paths
- Setter / closer / cx mobile surfaces tuned to in-field use

---

## 17. Open Decisions (Deferred)

- **Secrets manager:** Doppler vs 1Password CLI vs Vercel-only. Decide at first non-trivial secret.
- **Mobile design system:** Tamagui vs RN-friendly shadcn-equivalent. Decide at Phase 5.
- **Agent persona name and voice.** Configurable per workspace, but a default is needed.
- **Customer-facing public API.** Likely tRPC's REST adapter or a hand-rolled Hono server in `packages/api`. Decide post-Phase-3 based on customer demand.
- **Multi-currency.** Out of scope for MVP. Schema supports it; UI does not yet.
- **Setter attribution.** Phase 3 or Phase 4 depending on customer signal.

---

## 18. References

- Old-app teardown: `docs/old-app-teardown.md` (port the agent's report here)
- Old-app source: `/Users/mac/Documents/GitHub/old app/` (read-only reference, never imported)
- ADRs: `docs/adr/` (one file per significant decision, dated)
- Glossary: `docs/glossary.md`

---

*This document is the source of truth for architectural decisions. Significant changes require an ADR in `docs/adr/`. Implementation may diverge in details; if the divergence is structural, update this document in the same PR.*
