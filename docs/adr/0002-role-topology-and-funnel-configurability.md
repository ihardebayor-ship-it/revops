# ADR-0002 — Role Topology and Funnel Configurability

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-04-30 |
| **Deciders** | antonio (founder), Claude (architect) |
| **Supersedes** | — |
| **Superseded by** | — |

---

## Context

The old app baked a single role concept — "rep" — into nearly every table (`commission_entries.rep_email`, `goals.rep_email`, leaderboards keyed by rep). That decision foreclosed three things real high-ticket sales teams need:

1. **Multi-role sales motion.** The dominant high-ticket pattern is **setter → closer**, often with a **CX (Customer Success)** role attached for retention and refund-save work post-sale. A sale generates commission for two or three parties, not one.
2. **CX as a first-class role.** CX is paid for outcomes that materialize *after* the sale closes — retention milestones, expansion, save-flow successes. A schema that ends at the sale cannot pay them correctly.
3. **Workspaces that are not high-ticket.** A solo coach with one-rep-per-sale, or an agency with a custom role split (BDR → AE → AM), should use the same product without forking the data model.

The founder's directive: build for setter / closer / CX from the ground up, **and** keep the platform flexible enough for a solo seller or a custom-role business to use it as they wish.

A naive read of "build for setter / closer / CX" is to add three columns to `sales` (`setter_user_id`, `closer_user_id`, `cx_user_id`). That's the trap. It hardcodes a topology, breaks the moment a workspace adds a fourth role, and turns commission rules into per-column branching forever.

## Decision

We model role topology as **workspace-configured data**, not enum or schema. Two role concepts are split cleanly, four topology presets ship out of the box, and every commission, goal, leaderboard, and funnel-stage reference is parameterized by `sales_role_id`.

### 1. Two role concepts, split

| Concept | Defined by | Used for | Examples |
|---|---|---|---|
| **`access_role`** | Platform (fixed enum) | Authorization — what UI/data/actions a user can see and perform | `superadmin`, `workspace_admin`, `sub_account_admin`, `manager`, `contributor`, `viewer` |
| **`sales_role`** | Workspace (configurable rows) | Business logic — funnel-stage ownership, commission allocation, leaderboard grouping | `setter`, `closer`, `cx`, plus any custom role the workspace defines |

These are independent dimensions. A user has exactly one `access_role` per `sub_account` membership and zero or more `sales_role` assignments. A player-coach manager has `access_role=manager` and `sales_roles=[closer]`. A pure ops admin has `access_role=workspace_admin` and no sales roles.

### 2. Four topology presets, plus Custom

A workspace picks a preset during onboarding. The preset seeds rows in `sales_roles`, default rows in `commission_rules`, and defaults in `funnel_stages.stage_ownership`.

| Preset | Roles | Default split | Funnel stages | Use case |
|---|---|---|---|---|
| **Solo** | `seller` (100%) | 100% | optin → contacted → booked → showed → closed → collected | Solo coach, single-rep agency, indie SaaS founder |
| **Setter + Closer** | `setter` (20%), `closer` (80%) | 20 / 80 | optin → contacted → booked → showed → pitched → closed → collected | Most high-ticket sales teams |
| **Setter + Closer + CX** | `setter` (15%), `closer` (70%), `cx` (15%) | 15 / 70 / 15 | optin → contacted → booked → showed → pitched → closed → collected → retained / churned / refunded | Teams paying CX for retention or save-flow outcomes |
| **Custom** | user-defined | user-defined | user-defined | Anything else (BDR/AE/AM, SDR/AE, junior/senior closer, regional splits) |

Presets are **defaults at setup**, not constraints. A workspace can edit, add, remove, or rename roles after onboarding without losing history (versioning rules below).

### 3. Multi-party commission engine

Every sale carries a `commission_recipients[]` set. Each recipient row contains `user_id`, `sales_role_id`, `share_pct` (or computed amount), `rule_version_id`, `status`, and timestamps for the hold-period state machine. The engine:

1. Looks up workspace `commission_rules` matching the sale's product/source/period.
2. For each `sales_role` referenced by matching rules, finds the user(s) assigned to that role for the relevant `(sub_account, time, customer)` slice.
3. Computes per-recipient amount inside a Postgres transaction wrapped by an Inngest workflow.
4. Writes one `commission_entry` per recipient, each linked to a `payment_plan_installment` (not the sale) — cash-collected commissions only fire as installments collect.
5. Stores `computed_from` (rule version + inputs) for audit and recompute.

Hold-period state is a three-state machine on each entry: `pending_until` → `available_at` → `paid_at`. Default 30-day hold, configurable per workspace and per product. CX commissions can hold longer (e.g. 90-day retention threshold).

### 4. Funnel stages and dispositions are configurable

`funnel_stages` rows belong to a workspace; `funnel_events` is an append-only stream. Stage ownership is declared on `sales_roles.stage_ownership[]` so the inbox, leaderboard, and analytics know which role drives which stage.

`dispositions` (call/sale outcomes — `not_qualified`, `price_objection`, `timing`, etc.) are also workspace-configured taxonomies. Each disposition belongs to a category (`positive`, `objection`, `disqualification`, `won`) so the analytics layer can group consistently across workspaces with different vocabularies.

### 5. Versioning preserves history

Editing a `sales_role`, `commission_rule`, or `funnel_stage` does **not** retroactively rewrite history. Mutations create new versions; existing `commission_entries`, `funnel_events`, and `tasks` reference the version that produced them. A workspace can rename "closer" to "AE" without invalidating last quarter's commissions.

## Alternatives considered

### A. Hardcode setter / closer / cx columns on `sales`

The shortest path. Add three FK columns to `sales`, three columns to `goals`, three columns to `leaderboards`. Rejected because:

- **It locks out everyone who isn't setter+closer+cx.** Solo sellers carry empty columns. BDR/AE/AM workspaces force a wrong mapping. Adding a fourth role requires a migration on every reference.
- **Commission rules become per-column branching.** Every rule grows three (or more) cases. Adding a role grows every rule.
- **Workspace-level flexibility is the explicit founder directive.** Hardcoding contradicts it.

### B. Make `sales_role` a fixed platform enum (setter, closer, cx, seller, custom_1, custom_2…)

Slightly more flexible than (A), but every workspace inherits a global vocabulary that doesn't match their internal language ("AE" vs "closer"), and workspace-level customization remains awkward. Rejected — same root issue, lipstick on it.

### C. JSON blob of roles per sale

Store recipients as a JSON column on `sales`. Rejected — destroys queryability for leaderboards, commission-by-role analytics, and audit. We'd need to rebuild it as a join table at the first analytics question. The right shape is the join table from day one.

### D. Skip role topology in MVP, add it in Phase 3

Tempting because it reduces Phase-0 schema surface. Rejected because:

- **Migrations on `commission_entries` and `sales` after they have data are expensive.** Phase 1 ships the commission engine; if we ship it single-party, we redo it multi-party in Phase 3 and migrate live commission data.
- **The agent's tool registry references `sales_role_id` for goals, leaderboards, and inbox filtering.** Retrofitting the agent's surface is more work than building it correctly.
- **The data model decisions cannot be deferred even when the UI for them can.** This is the load-bearing principle in [ARCHITECTURE.md §16](../ARCHITECTURE.md).

## Consequences

### Positive

- A solo coach using the **Solo** preset never sees role configuration UI; the platform "just works" with one role at 100% share. Same code, same tables.
- A high-ticket agency on **Setter + Closer + CX** gets multi-party commissions, hold periods tied to retention milestones, and a CX queue for save flows — no schema changes, just configuration.
- A workspace with an unusual structure (BDR/AE/AM, regional splits, junior/senior closers) uses **Custom** without forking anything. Their `commission_rules` reference their `sales_roles`; the engine doesn't care.
- The agent's tool registry takes `sales_role_id` as a parameter where relevant. The agent works identically across all topologies — its prompts adapt to the workspace's vocabulary.
- Versioning preserves history through role/rule changes. Renaming "closer" to "AE" mid-quarter does not invalidate any past commission entry.

### Negative

- **The onboarding flow must walk a user through preset selection.** A user who lands cold and does not understand role topology gets confused. Mitigation: Solo is the default with a one-click choice; the more complex presets are surfaced only if the user signals a team larger than themselves.
- **The commission engine is more complex than a single-party engine.** Mitigated by the engine being one well-tested module in `packages/domain/commissions/` rather than scattered logic, and by golden tests covering every preset.
- **Workspace-configured taxonomies (`dispositions`, `funnel_stages`) need cross-workspace category mappings (`category` field) for the analytics layer to render consistent dashboards.** Acceptable trade-off; the alternative (forcing a global taxonomy) is worse.

### Risks accepted

- **A workspace that mis-configures its topology** (e.g. picks Setter+Closer when they're solo) gets a confusing UX. Mitigated by an onboarding wizard that asks plain-language questions ("How many people are involved in closing a sale?") and recommends a preset, and by topology being editable post-onboarding.
- **CX commissions tied to retention milestones may collide with refund-clawback edge cases** (e.g. a CX is paid for a 90-day retention milestone, and the customer refunds at day 100). Modeled by the same hold-period state machine the closer uses, and tested explicitly in the commission engine's golden suite.

## Implementation notes

### Schema (Phase 0)

```
sales_roles                          (workspace-scoped, configurable)
sales_role_versions                  (immutable history)
sales_role_assignments               (user × sales_role × sub_account)
funnel_stages                        (workspace-scoped, configurable)
funnel_stage_versions                (immutable history)
funnel_events                        (append-only, references stage_version_id)
dispositions                         (workspace-scoped)
commission_rules                     (workspace-scoped)
commission_rule_versions             (immutable history)
commission_entries                   (per-recipient, references rule_version_id and installment_id)
```

### Onboarding wizard (Phase 0)

Three questions, then a preset is selected (and editable):

1. "Is anyone besides you involved in closing a sale?"
2. "Do you have a separate person who books the call vs. closes the sale?"
3. "Do you pay anyone for keeping customers around (retention) or saving them from refunds?"

Mapping:

- All "no" → **Solo**
- Yes to #2 only → **Setter + Closer**
- Yes to #2 and #3 → **Setter + Closer + CX**
- Any answer plus "I want to define my own roles" toggle → **Custom**

### Agent surface

The agent reads the active workspace's `sales_roles` and adjusts vocabulary in its system prompt. A workspace using "AE" sees responses about "AEs"; a workspace using "closer" sees "closers". This is a templated prompt, not per-workspace fine-tuning.

### Default commission rule (Phase 1)

For each preset, Phase 1 ships one rule per role with the default share — flat-rate, paid on collected installments, with a 30-day hold. Tiered, bonus, accelerator, and override rules ship in Phase 3.

## Related

- [ARCHITECTURE.md §6 — Domain Model](../ARCHITECTURE.md)
- [ARCHITECTURE.md §7 — Tenancy & Access Control](../ARCHITECTURE.md)
- [ARCHITECTURE.md §1.3 — Principles](../ARCHITECTURE.md) (specifically principle #10, flexibility over opinionation)
- ADR-0001 — Tech stack
- [old-app-teardown.md §8 — Worth Keeping](../old-app-teardown.md) (commission engine logic preserved and hardened)
