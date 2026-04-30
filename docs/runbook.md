# RevOps Pro — Runbook

> Operator-facing setup, account provisioning, and common ops procedures.
> Source-of-truth for "how do I…" questions during development.

---

## 1. Initial setup (do once)

### 1.1 Toolchain

- **Node** 20.18+ (`.nvmrc` pins 20.18.0)
- **pnpm** 10.0+ (auto-installed via Corepack — `corepack enable pnpm`)
- **Postgres client** (`psql`) optional but useful

```bash
corepack enable pnpm
pnpm install
```

### 1.2 Provision accounts

All free-tier. Estimated total time: **~15 minutes**.

| # | Service | URL | What you need |
|---|---|---|---|
| 1 | **Neon** Postgres | https://console.neon.tech | DATABASE_URL (dev branch) |
| 2 | **Better Auth** secrets | local | BETTER_AUTH_SECRET (`openssl rand -base64 32`), TOKEN_ENCRYPTION_KEY (`openssl rand -hex 32`) |
| 3 | **Vercel** hosting | https://vercel.com | Account + GitHub connection (deploy later) |
| 4 | **Inngest** jobs | https://app.inngest.com | INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY |
| 5 | **Anthropic** Claude | https://console.anthropic.com | ANTHROPIC_API_KEY |
| 6 | **Pusher** realtime | https://dashboard.pusher.com | App ID, key, secret, cluster |
| 7 | **Resend** email | https://resend.com | RESEND_API_KEY |
| 8 | **Sentry** errors | https://sentry.io | SENTRY_DSN (optional for dev) |
| 9 | **Axiom** logs | https://app.axiom.co | AXIOM_TOKEN (optional for dev) |
| 10 | **PostHog** product analytics | https://us.posthog.com | NEXT_PUBLIC_POSTHOG_KEY (optional for dev) |
| 11 | **Langfuse** LLM traces | https://cloud.langfuse.com | LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY |
| 12 | **Cloudflare R2** storage | https://dash.cloudflare.com | Account ID, access keys (Phase 1+) |

### 1.3 Configure env

```bash
cp .env.example .env.local
# Fill in DATABASE_URL, BETTER_AUTH_SECRET, TOKEN_ENCRYPTION_KEY at minimum.
# Other services can be left blank during early development.
```

The Zod env schema in `packages/config/src/env.ts` validates at boot. The app refuses to start with missing or malformed required vars.

### 1.4 Provision the database

```bash
# Generate migrations from the Drizzle schema
pnpm db:generate

# Apply hand-rolled extensions migration first (pgvector + pgcrypto)
psql $DATABASE_URL -f packages/db/drizzle/0000-extensions.sql

# Apply drizzle-kit-generated migrations
pnpm db:migrate

# Seed platform_settings singleton
pnpm db:seed
```

If using Neon and you want a dev branch per PR, install the Neon Vercel integration so previews get isolated branches automatically.

### 1.5 Run dev

```bash
pnpm dev
```

This boots:
- `apps/web` on http://localhost:3000
- Turbo watches every package and rebuilds on change

For Inngest local dev:

```bash
pnpm dlx inngest-cli@latest dev
```

Then point your local app's `INNGEST_EVENT_KEY` to whatever the CLI prints.

---

## 2. Common procedures

### Add a new domain table

1. Add a file in `packages/db/src/schema/`
2. Export from `packages/db/src/schema/index.ts`
3. `pnpm db:generate`
4. Review the generated migration in `packages/db/drizzle/`
5. `pnpm db:migrate`

### Add a new agent tool

1. Create `packages/agent/src/tools/<domain>/<tool>.ts`
2. Use `defineTool` — declare `risk`, `reversible`, `authorize`, `idempotencyKey`
3. Register in `packages/agent/src/tools/index.ts`
4. Add a golden eval covering the tool in `packages/agent/src/evals/`

### Add a new integration

1. `packages/integrations/src/<name>/` directory
2. Files: `client.ts`, `oauth.ts` (if needed), `signature.ts`, `types.ts`, `events.ts`
3. Webhook route at `apps/web/src/app/api/webhooks/<name>/route.ts` — verify signature, ack 200, enqueue Inngest event
4. Inngest function at `packages/jobs/src/functions/webhooks/<name>.ts` — idempotency check, parse, call domain logic, write audit_log

### Reset the dev database

```bash
psql $DATABASE_URL -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql $DATABASE_URL -f packages/db/drizzle/0000-extensions.sql
pnpm db:migrate
pnpm db:seed
```

### Inspect the database

```bash
pnpm db:studio
```

Opens Drizzle Studio at http://local.drizzle.studio

---

## 3. Deploy

Deferred until end of Phase 0. Vercel will deploy `apps/web`; Inngest will deploy via its GitHub app pointing at `apps/web/src/app/api/inngest/route.ts`.

---

## 4. Troubleshooting

### "Invalid server environment configuration" on boot

The Zod schema rejected your env. Check the console output for the specific field that failed.

### Drizzle migration fails on `vector` type

`pgvector` extension is not enabled. Run:
```bash
psql $DATABASE_URL -f packages/db/drizzle/0000-extensions.sql
```

### Better Auth tables missing

Better Auth's tables (`user`, `session`, `account`, `verification`) are defined in `packages/db/src/schema/auth.ts` and migrated by drizzle-kit. If they're missing, your migrations did not run; see "Reset the dev database".
