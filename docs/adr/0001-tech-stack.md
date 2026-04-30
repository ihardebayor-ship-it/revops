# ADR-0001 — Tech Stack

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-04-30 |
| **Deciders** | antonio (founder), Claude (architect) |
| **Supersedes** | — |
| **Superseded by** | — |

---

## Context

RevOps Pro is a clean-slate rebuild of [C2C Tracker](../old-app-teardown.md). The old app was built on Vite + Supabase + Vercel inside Lovable. It ships features but does not run safely in production: wildcard CORS, unvalidated webhook signatures, plaintext OAuth tokens, no background-job system, no observability, hash-based routing, 3,000-line god components, and one test file.

The rebuild has four hard constraints set by the founder:

1. **Mobile is in-scope** — but only after web is solid. The repo and design system must be mobile-ready from day one.
2. **Dirt-cheap to run** — free-tier-first MVP; meaningful spend only with funding.
3. **Fully managed services first** — self-hosting is a future option, not a Phase-0 burden.
4. **AI agent foundational and elite** — the agent is not a feature, it is the operating layer of the product.

Beyond those, the product is multi-tenant (workspace → sub_account → user), webhook-heavy (GHL, Whop, Stripe, Typeform, JotForm, Aircall, Fathom), commission-heavy (multi-party, installment-based, hold periods, clawback), and analytics-heavy (per-role dashboards, cohort comparisons, native charts only).

Three architectural shapes were considered:

- **A. Stay in the Supabase ecosystem** — Postgres + Auth + Storage + Realtime + Edge Functions bundled. Cheaper, less integration glue, RLS at DB level. But edge functions are exactly what produced the old app's fragility, and there is no first-class job queue.
- **B. Decompose into best-of-breed managed services** — Postgres, Auth, Jobs, Realtime, Email, Errors, Logs, Product, LLM each chosen independently. More integration work, more bills, but each piece is best-in-class and replaceable.
- **C. All-in-one reactive (Convex)** — DB + auth + functions + realtime + jobs in one. Excellent DX. But vendor-locked and weak for the SQL-heavy commission and analytics work this product depends on.

## Decision

We adopt **shape B**, anchored on **Postgres**. Each service is selected for free-tier viability at MVP and a clean migration path when funded.

### Locked stack

| Layer | Pick | Why this | Free-tier reality | Funded path |
|---|---|---|---|---|
| Frontend framework | **Next.js 15 (App Router)** | RSC + Server Actions, mature, Vercel-native | Vercel Hobby | Vercel Pro $20/mo |
| Hosting | **Vercel** | Zero-config Next deploys, preview envs, edge | Free for non-commercial | Pro at launch |
| Database | **Postgres on Neon** | Serverless, branching per env, no Supabase coupling | 0.5 GB + branching | Neon Scale |
| ORM | **Drizzle** | Type-safe, lightweight, SQL-first | OSS | OSS |
| Auth | **Better Auth** | OSS, runs on our Postgres, has Organizations plugin, no per-MAU pricing | Free | Clerk only if SSO/SCIM demand emerges |
| Jobs / durable workflows | **Inngest** | Replaces edge-function fragility — durable steps, retries, observability built-in | 50k runs/mo, 7-day history | Inngest paid |
| Outbound webhooks (to customers) | **Inngest** at MVP | Avoids buying Svix until volume justifies it | Covered in jobs allowance | Svix when scale demands |
| Realtime | **Pusher Channels** | Simplest reliable WebSocket service | 200k msg/day, 100 concurrent | Ably or Pusher paid |
| AI brain | **Claude (Sonnet 4.6 default · Opus 4.7 hard · Haiku 4.5 cheap)** | Best-in-class reasoning + tool use; aligned with our agent's operator role | Pay per token only | Same |
| AI orchestration (UI) | **Vercel AI SDK** | Streaming, tool-use UX patterns | Free OSS | Same |
| AI orchestration (server) | **Inngest agent workflows** | Multi-step agent runs that survive crashes | Same as jobs | Same |
| Vector / RAG | **pgvector on Neon** | In our DB; no vendor to migrate from | Free | Same |
| LLM observability | **Langfuse Cloud** | Per-prompt tracing, cost, latency, eval scoring | 50k traces/mo | Self-host on Fly |
| Errors | **Sentry** | Industry standard | 5k events/mo | Sentry Team $26/mo |
| Logs / APM | **Axiom** | Generous free tier, structured logs + APM in one | 0.5 TB/mo | Same |
| Product analytics + flags | **PostHog Cloud** | Funnels + flags + session replay in one tool | 1M events/mo | Self-host or paid |
| Email | **Resend** | Best DX in the category | 3k/mo, 100/day | Resend paid |
| Billing (our SaaS) | **Stripe Billing** | Standard | % per txn only | Same |
| File storage | **Cloudflare R2** | Zero egress fees — outclasses S3 for us | 10 GB free | Same |
| Charts / analytics UI | **Tremor + Recharts** | Native React, kills Metabase | Free OSS | Same |
| Type-safe RPC | **tRPC** | End-to-end types between server actions, tools, and the agent | Free OSS | Same |
| Validation | **Zod** | Shared schemas across HTTP, webhooks, agent tools, env, DB | Free OSS | Same |
| Forms | **React Hook Form + Zod** | Standard | Free OSS | Same |
| Testing | **Vitest + Playwright + Storybook** | None of which existed in the old app | Free OSS | Same |
| Repo | **Turborepo + pnpm** | Mobile-ready monorepo from day one | Free OSS | Same |

### Estimated MVP run cost

$0–$20/mo of fixed cost, plus Claude API tokens (variable, ~$5–$50/mo at MVP usage). Vercel Pro ($20) becomes mandatory at the moment we have paying customers (commercial use of Hobby tier is a violation). Sentry, Axiom, PostHog, Inngest, Neon, Resend all sit comfortably inside free tiers through hundreds of MAU.

### Architectural consequences

1. **No separate API server.** Next.js route handlers + Server Actions + tRPC cover the full API surface. `packages/api` is structured so it can extract to a Hono server later (mobile, public API) without a rewrite.
2. **Inngest is the spine for everything async.** Inbound webhooks, scheduled jobs, agent multi-step workflows, outbound delivery to customers — one system, one observability surface. The old app's homegrown `outbound_webhook_deliveries` table is dead.
3. **The agent runs server-side, not in the browser.** Vercel AI SDK streams the conversation; tool execution happens in Inngest steps with full audit and retry semantics. The agent runs under the user's identity (see ADR-0002 / §7.6).
4. **Postgres is the source of truth for everything.** App data, RLS multi-tenancy, audit log, conversation history, semantic memory (pgvector), eval results. No separate vector DB, no separate event store.
5. **Type safety is a load-bearing teammate.** Zod schemas are shared between agent tool definitions, tRPC procedures, webhook handlers, env validation, and Drizzle queries. One source of truth per shape.

## Alternatives considered

### Auth: Clerk vs Better Auth

Clerk has the strongest B2B Organizations product, but at scale costs $25/mo + per-MAU. Better Auth is OSS, runs on the same Postgres we already pay for, and supports the multi-tenant patterns we need via its Organizations plugin. The migration path to Clerk if we ever need enterprise SSO/SCIM is a contained refactor (a few weeks at most), and that bridge gets crossed when funded. **Better Auth wins on cost, sovereignty, and not making auth a load-bearing third party at the MVP stage.**

### Database: Supabase Postgres vs Neon

Supabase bundles Postgres + Auth + Storage + Realtime, which is convenient. But the coupling is what hurt the old app: edge functions were used for everything async because the database was the path of least resistance, and they are not built for that. Neon decouples Postgres from the rest of the stack. Branching per preview env is a strict win for Vercel-style deploys. **Neon wins on focus and sovereignty.**

### Jobs: Inngest vs Trigger.dev vs BullMQ self-host

Inngest and Trigger.dev are the two strongest managed options. Inngest's durable-step model (`step.run`) maps cleanly onto agent workflows that need to survive timeouts and call tools across multiple LLM round-trips. Both have generous free tiers; Inngest's developer ergonomics around step retries, sleep, and event replay are stronger for our use case. BullMQ + self-hosted Redis is rejected for MVP — operating the queue is not where we want to spend time. **Inngest wins.**

### LLM observability: Langfuse vs Helicone vs Helix

Langfuse is OSS-with-cloud, has the strongest eval-runner story, and is self-hostable when we outgrow the free tier or want sovereignty. Helicone is fine but more proxy-shaped. **Langfuse wins on eval workflow + escape hatch.**

### Frontend: Next.js vs Remix vs TanStack Start vs SPA

Next.js 15 has the largest ecosystem, strongest hosting story (Vercel), and a stable App Router. Remix would also work and is arguably simpler conceptually, but the ecosystem and hiring pool are smaller. TanStack Start is exciting but unproven at the scale we're aiming for. SPA was the old app's choice and is a non-starter for a multi-tenant SaaS with auth-protected routes and SEO needs. **Next.js wins on ecosystem and hosting alignment.**

### Realtime: Pusher vs Ably vs Supabase Realtime vs SSE-only

We need realtime for: live commission updates, leaderboard nudges, agent message streaming when running durably in Inngest, inbox badge counts. Supabase Realtime is rejected with the rest of Supabase. Ably has a more generous free tier (6M msgs/mo) but a slightly more complex API. Pusher's simplicity wins for MVP; both are interchangeable behind a thin abstraction in `packages/realtime/`. **Pusher wins on simplicity; Ably is the trivial swap-out.**

### Convex (rejected)

Convex's reactive queries and end-to-end types are genuinely beautiful. Rejected for two reasons: (1) commission and analytics work in this product is SQL-heavy, with semantic operations (window functions, lateral joins, cohorts) that Convex's query language does not match, and (2) vendor lock-in on a foundational layer is unacceptable when we're explicitly designing for fundability and migration optionality.

## Consequences

### Positive

- $0–$20/mo MVP run cost; long runway from a $0 starting point.
- Every paid service has a clearly documented swap or self-host path. No layer of the stack is one bad pricing change away from forcing a rewrite.
- Inngest replaces three things from the old stack at once: async edge functions, the homegrown webhook delivery table, and the missing observability around background work.
- Postgres + Drizzle + pgvector keeps domain data, audit log, conversation history, and semantic memory in one place. One backup, one migration tool, one query language.
- Mobile (Phase 5) lands as a sibling app under `apps/mobile/` consuming the same `packages/ui`, `packages/db`, and `packages/agent` — no rewrites, no parallel APIs.
- The agent is a first-class citizen of the architecture, not a microservice with its own data plane.

### Negative

- More managed-service accounts to wire up at MVP than Supabase-only would require (Vercel + Neon + Inngest + Sentry + Axiom + Langfuse + PostHog + Resend + Pusher + Cloudflare). Mitigated by good `.env` hygiene and a setup checklist in `docs/runbook.md`.
- Better Auth is younger than Clerk; we accept the slightly higher implementation effort in exchange for cost and sovereignty.
- Pusher's free tier ceiling (200k msg/day, 100 concurrent) will become tight as we scale; the migration to Ably or paid Pusher is hours of work but is not free.

### Risks accepted

- **LLM cost is the only true variable.** A poorly-scoped agent loop can burn money. Mitigation: prompt caching on (target >80% hit rate), routing logic in `packages/agent/runtime.ts` defaults to Sonnet, escalates to Opus only on detected ambiguity, falls to Haiku for cheap summarization, and Langfuse alerts on cost-per-thread anomalies.
- **Better Auth maturity.** If a critical limitation surfaces, fallback to Clerk is contained — auth state lives in our Postgres, the migration is moving session and account data plus updating route handlers.
- **Vendor concentration on Vercel.** If Vercel becomes hostile (pricing, policy), Next.js runs on Cloudflare Pages, Netlify, and self-hosted Node. The lock-in is shallower than the perception.

## Implementation notes

- Stack choices are encoded in [ARCHITECTURE.md §4](../ARCHITECTURE.md). Any future change to a row in that table requires a new ADR superseding this one.
- Provisioning runbook (account creation, env-var generation, secret rotation) lands in `docs/runbook.md` before Phase 0 begins.
- `.env.example` enumerates every required env var with comments explaining what it gates. `packages/config/env.ts` validates at boot via Zod and refuses to start with missing or malformed envs.

## Related

- [ARCHITECTURE.md](../ARCHITECTURE.md) — full architecture, of which this ADR locks §4
- ADR-0002 — Role topology and funnel configurability
- [old-app-teardown.md](../old-app-teardown.md) — what we are explicitly not repeating
