# Old App Teardown — C2C Tracker

> **Status:** Reference only · Captured 2026-04-30
> **Source:** `/Users/mac/Documents/GitHub/old app/` (Lovable-originated React/Vite + Supabase MVP)
> **Purpose:** Frozen record of what existed in the predecessor product. RevOps Pro inherits the strategy, domain model, and design language. It does not inherit the code.

---

## 1. Product Summary

**C2C Tracker** is a B2B SaaS sales operations and commission management platform targeting high-ticket sales teams. It provides:

- Call/appointment tracking with GHL integration for bidirectional appointment syncing
- Commission management with tiered rules, admin overrides, clawback logic, and period-based payouts
- Multi-level team hierarchy (Workspace → Sub-Account → Reps) with role-based dashboards
- Sales pipeline visibility with unlinked sales/calls reconciliation and payment plan tracking
- Commission-driven gamification (streaks, leaderboards, inbox clearing)
- Analytics via embedded Metabase and emerging native dashboard

**Core users:** Sales reps (track calls, view earnings), managers (oversee team performance, set goals), ops admins (reconcile sales, manage integrations).

The product is **feature-rich but architecturally fragile**. The roadmap document itself rated code quality 4/10 vs. enterprise standard of 8/10.

---

## 2. Stack & Infrastructure

**Frontend:**
- React 18.3 + TypeScript 5.8, Vite 5.4, hosted on Vercel
- shadcn-ui, TailwindCSS 3.4, Framer Motion
- React Query 5.83, Zod, React Hook Form
- Metabase embedding (SDK 0.57), Recharts 2.15
- Disabled agent chat (feature flag off)
- Dark theme default

**Backend:**
- Supabase PostgreSQL with RLS
- Supabase Auth (email/password, Google OAuth)
- 55+ Deno-based edge functions for webhooks, integrations, scheduled jobs
- Supabase Realtime (minimal use)

**Integrations:**
- GoHighLevel (OAuth, partial bidirectional sync)
- Typeform / JotForm (webhook-based form capture)
- Custom webhooks
- Metabase (planned replacement)
- Whop integration plan (designed, not implemented)
- Stripe / Authorize.net / CopeCart / NMI (planned)

**Hosting:** Vercel + Supabase.

---

## 3. Feature Inventory

### Built and working

| Feature | Notes |
|---|---|
| Core call tracking (CRUD) | Appointments logged, outcomes set |
| Commission system | Multi-tier rules, flat rates, bonuses, payouts, clawback |
| Goals management | Templates, period tracking, validation |
| GHL integration (one-way) | OAuth, appointment sync, some field mapping issues |
| Multi-tenancy / RLS | Workspace/sub-account isolation at DB |
| Typeform / JotForm webhooks | Opt-in and application form capture |
| Role-based dashboards | Rep, manager, sub-account admin views |
| Leaderboards | Rep rankings by commission, revenue |
| Follow-up tracking | Scheduled follow-ups, overdue detection |
| Payment plan grouping | Auto-detection via fuzzy matching, manual override |
| Native analytics (beta) | KPI cards, charts, funnel visualizations |

### Planned but not built

- Unified inbox aggregating calls, tasks, messages, alerts
- Payment processor native integrations (Whop OAuth, Stripe Connect, CopeCart)
- AI agent / chat (code present, feature-flagged off)
- GHL bidirectional sync (one-way works)
- Scheduled task / follow-up automation with AI recommendations
- Historical data import tool ("Transfer")
- Calendar integrations (Calendly, Acuity, Cal.com)
- CRM integrations (HubSpot, Close CRM)
- Forecasting and probability-weighted pipeline
- AI-powered daily briefings
- Setter attribution
- Marketing attribution (Google Ads, Meta, HubSpot)

---

## 4. Data Model (key tables)

| Table | Purpose |
|---|---|
| `workspaces` | Tenant root |
| `sub_accounts` | Team within workspace |
| `profiles` | User accounts |
| `user_sub_account_access` | Role assignments |
| `calls` | Appointments / calls with linked sales, recordings, transcripts |
| `sales` | Transactions with payment processor, refund link |
| `payment_plans` | Subscriptions / installments |
| `commission_entries` | Commission ledger |
| `commission_rules` | Rules engine (flat, tiered, bonus, override) |
| `commission_periods` | Payout periods |
| `applications` / `optins` | Form submissions |
| `data_sources` / `data_source_connections` | Integration configs and per-tool creds |
| `ghl_field_mappings` | Form-field → GHL custom-field maps |
| `goals` | Rep / team targets |
| `outbound_webhook_config` | Customer webhooks |

### Schema smells

1. No transactions on commission cascades
2. Denormalized `current_status` on calls
3. Mixed text/UUID identifier types
4. Missing indexes on hot query paths
5. DRY violations across field-mapping tables
6. No soft deletes on key entities
7. Audit trail gaps
8. Unstructured `custom_fields` JSON columns

---

## 5. Design System

- **Aesthetic:** Dark-first B2B SaaS. Pure black backgrounds, dark card surfaces, 8px border radius, accent blue `#2780FF`, accent purple `#A745FF`.
- **Typography:** Inter. Display 36 → H1 30 → H2 24 → H3 20 → Body 14 → Caption 12.
- **Components:** shadcn-ui primitives wrapped in custom layouts. Metric cards with trend badges. Tab navigation. Status badges.
- **Animations:** Framer Motion — page transitions, card stagger, fade-in/up, hover lift, count-up.
- **Layout:** 256px sidebar (64px collapsed), sticky header, responsive mobile/tablet/desktop.

Design specs lived in `GOOGLE_STITCH_DESIGN_BRIEF.md`, `DESIGN_REFERENCE.md`, `ANALYTICS_DESIGN_SPEC.md`.

---

## 6. Integrations

- **GHL** — OAuth 2.0, appointments sync (one-way working), opportunities sync (partial), field mapping UI.
- **Typeform** — OAuth, webhook form capture, field mapping.
- **JotForm** — API key auth, webhook-based.
- **Whop** — 87KB design doc, not deployed.
- **Stripe / Authorize.net / CopeCart / NMI** — sketches only.
- **Metabase** — embedded dashboards (planned replacement).
- **Fathom** — recording / transcript webhooks.
- **MCP** — partial OAuth integration for AI agent context.

---

## 7. Production-Readiness Gaps

### Security (critical)
1. Wildcard CORS on all 55 edge functions
2. Webhook signatures unvalidated (GHL, Typeform, JotForm)
3. OAuth tokens stored plaintext, no encryption, no rotation, race condition in refresh
4. `admin-user-management` may allow privilege escalation; commission tables RLS gaps

### Code quality
- **God components:** `UpdateCallPage.tsx` 3,257 lines · `useUnlinkedSales.ts` 2,507 lines · `SubAccountDataSourcesPage.tsx` 1,480 lines
- **Type safety:** 50+ `as any` casts, TypeScript not in strict mode, no Zod on API responses
- **Debug code:** 69 `console.log` statements, untracked TODOs, commented-out code in 24 files
- **Tests:** 1 file (`tests/statistics.test.ts`). Zero component / hook / integration tests.

### Accessibility
- Missing `htmlFor` on labels
- Icon-only buttons without `aria-label`
- No focus trapping in modals
- Color-only status indicators
- Incomplete keyboard navigation

### Performance
- Missing indexes on hot paths
- Hardcoded `.limit(500)` instead of pagination
- N+1 queries in commission calculations
- No caching layer

### Error handling
- Bare `.catch()` with no recovery
- Generic error messages
- No webhook retry logic (despite the queue table)
- No Sentry despite dependency installed

### Data integrity
- Refund cascades not transactional
- No idempotency keys → duplicate sales possible
- No soft deletes
- Incomplete commission audit trail

### Routing
- Hash-based routing breaks deep linking and refresh
- Filter state lost on refresh

---

## 8. Worth Keeping (informs RevOps Pro)

1. **Multi-tenancy / RLS model** — Workspace → Sub-Account → User well-designed
2. **Commission engine logic** — multi-rule (flat / tiered / bonus / override / clawback) is sound
3. **Data source + connection abstraction** — clean recent migration, scales to multiple tools per type
4. **Field mapping pattern** — flexible, extensible
5. **Gamification primitives** — streaks, leaderboards, inbox-zero copy
6. **Edge-function naming + domain organization**
7. **Product vision and copy** — roadmap, design briefs are well-written
8. **GHL OAuth implementation** — works, extensible

---

## 9. Worth Throwing Out

1. Hash-based routing
2. God components / monolithic hooks (rewrite, do not refactor)
3. Lovable as primary IDE / workflow
4. Embedded Metabase
5. Disabled AI agent code (start over for the elite version)
6. Custom outbound webhook delivery system (replaced with Inngest, eventually Svix)
7. Typeform / JotForm duplicated logic
8. No-observability posture

---

## 10. Open Questions Carried Into RevOps Pro

1. Payment processor priority — Whop first or Stripe first?
2. AI agent: foundational from day one (RevOps Pro: yes, this is locked).
3. Metabase replacement timing — RevOps Pro: replaced from day one, native only.
4. Multi-location GHL support per sub_account — TBD.
5. Setter attribution scope and timing — TBD (Phase 3 or 4).
6. Marketing attribution — TBD.
7. Subscription tiers — RevOps Pro will use Stripe Billing.
8. Compliance scope — RevOps Pro: GDPR-ready from day one, SOC 2 path open, HIPAA out of scope.
9. Offline mode for reps — TBD at mobile phase.
10. Mobile-first vs desktop-first — RevOps Pro: desktop first, mobile in Phase 5.

---

*This is a frozen reference. The old app source remains at `/Users/mac/Documents/GitHub/old app/` for grep-and-read purposes only — its code is never imported into RevOps Pro.*
