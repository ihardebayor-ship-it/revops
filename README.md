# RevOps Pro

Agent-native revenue operations platform for high-ticket sales teams.

## Status

**Phase 0 — Foundation.** Monorepo scaffolded, full Phase-0 schema, agent tool contract locked, brand-as-config wired. No features yet.

## Architecture

Read these in order:
1. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system, domain, tenancy, agent, integrations, jobs, security, roadmap
2. [docs/adr/0001-tech-stack.md](docs/adr/0001-tech-stack.md) — locked tech stack
3. [docs/adr/0002-role-topology-and-funnel-configurability.md](docs/adr/0002-role-topology-and-funnel-configurability.md) — multi-role + flexibility model
4. [docs/adr/0003-agent-architecture.md](docs/adr/0003-agent-architecture.md) — execution, tools, memory, evals, cost, safety
5. [docs/runbook.md](docs/runbook.md) — setup, accounts, common procedures
6. [docs/old-app-teardown.md](docs/old-app-teardown.md) — frozen reference of the predecessor

## Quick start

```bash
corepack enable pnpm
pnpm install
cp .env.example .env.local
# fill in DATABASE_URL, BETTER_AUTH_SECRET, TOKEN_ENCRYPTION_KEY at minimum
pnpm db:generate
psql $DATABASE_URL -f packages/db/drizzle/0000-extensions.sql
pnpm db:migrate
pnpm db:seed
pnpm dev
```

See [docs/runbook.md](docs/runbook.md) for full provisioning.

## Repo layout

```
apps/
  web/                    Next.js 15 (App Router)
packages/
  agent/                  AI core: tools, memory, runtime
  auth/                   Better Auth + authz policy
  config/                 Zod env schema, brand defaults
  db/                     Drizzle schema, migrations, client
  domain/                 Pure business logic (commissions, calls, sales…)
  integrations/           Typed clients (GHL, Whop, Stripe, Aircall…)
  jobs/                   Inngest functions
  tooling/                Shared tsconfig / eslint / tailwind presets
  trpc/                   Routers, context, middleware
  ui/                     Design system (RN-friendly primitives)
docs/
  ARCHITECTURE.md         Source of truth
  adr/                    Architecture Decision Records
  runbook.md              Operator-facing setup
```

## Principles

See [docs/ARCHITECTURE.md §1.3](docs/ARCHITECTURE.md). Highlights:

- The agent is foundational. Every domain action is a typed tool.
- Postgres is the source of truth — app data, audit log, semantic memory all in one DB.
- Type safety end-to-end. Zod at every boundary. No `any`.
- Durable by default. Webhooks, integrations, agent multi-step workflows all run in Inngest.
- Brand and copy are configuration, not code.
- Flexibility over opinionation. Sales roles, funnel stages, dispositions are workspace-configured.
