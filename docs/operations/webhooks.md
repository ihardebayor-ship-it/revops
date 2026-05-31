# Webhook Operations

## Signals

Webhook receivers emit structured log events without raw payloads or secrets:

- `webhook.received`: new inbound event persisted.
- `webhook.dedup`: provider retry or replay hit the idempotency key.
- `webhook.skipped`: receiver skipped before persistence, usually missing provider ids.
- `webhook.dispatch_failed`: receiver persisted the event but could not enqueue Inngest.
- `webhook.processed`: async processor completed tenant-scoped writes.
- `webhook.process_skipped`: async processor marked the event processed without writes.

Recommended alert thresholds:

- Any sustained `webhook.dispatch_failed` in production.
- `webhook.process_skipped` rate above normal baseline per provider.
- Non-empty `webhook_inbound_events.error` rows over a rolling 15-minute window.

## Replay Procedure

Preferred path: use the tenant-scoped ops view at `/{workspace}/integrations/webhooks`.
It lists inbound events by provider/status and exposes replay without showing raw payloads.

Replay from the UI:

1. Open `Integrations` → `Webhook events`.
2. Filter to `Failed` or the affected provider.
3. Confirm the row's `provider_account_id` belongs to the selected workspace/sub-account.
4. Click `Replay`.
5. Refresh or keep the filter open until status moves from `pending` to `processed`.

Manual fallback: use the migration/owner database URL for inspection. Do not log raw payloads in shared channels.

1. Identify failed rows:

```sql
select id, source, provider_account_id, external_id, received_at, processed_at, error
from webhook_inbound_events
where error is not null
order by received_at desc
limit 50;
```

2. Clear `processed_at` and `error` for rows that are safe to replay:

```sql
update webhook_inbound_events
set processed_at = null, error = null
where id = '<inbound-event-id>';
```

3. Re-enqueue the matching Inngest event:

- GHL: `ghl.webhook.received` with `{ "inboundEventId": "..." }`
- Aircall: `aircall.webhook.received` with `{ "inboundEventId": "..." }`
- Fathom: `fathom.webhook.received` with `{ "inboundEventId": "..." }`

4. Confirm replay completed:

```sql
select id, processed_at, error
from webhook_inbound_events
where id = '<inbound-event-id>';
```

## Status Semantics

- `pending`: `processed_at` is null and `error` is null.
- `processed`: `processed_at` is set and `error` is null.
- `failed`: `error` is set, regardless of `processed_at`.

Replay clears `processed_at` and `error`, then enqueues the provider-specific Inngest event.
Handlers are expected to remain idempotent: derived rows dedupe by tenant scope plus provider external ids, and funnel events dedupe through `source_event_id`/metadata hashing.

## Tenant Safety Checks

- Idempotency key is `(source, provider_account_id, external_id)`.
- GHL `provider_account_id` is the GHL `locationId`.
- Aircall `provider_account_id` is Aircall `data.user.id`.
- Fathom `provider_account_id` is derived from a signed local webhook scope key.
- Processors resolve tenant context before writes and run writes through `withTenant`.
- The ops list/replay route does not select or return raw `payload`.
- Replay is only allowed for events whose `(source, provider_account_id)` matches a provider account connected to the caller's workspace/sub-account.

## Downstream Provenance Decision

Do not add `provider_account_id` columns to derived entities until there is a concrete analytics or reconciliation query that needs them directly.

Current provenance is sufficient for Sprint 2:

- `webhook_inbound_events` owns provider-level idempotency with `(source, provider_account_id, external_id)`.
- `calls`, `sales`, `optins`, and `applications` dedupe inside tenant scope with `sub_account_id + source_integration + external_id`.
- `funnel_events.source_event_id` points back to the inbound webhook row, which carries `provider_account_id`.
- GHL provider account maps to one sub-account location; Aircall/Fathom tenant resolution happens before writes.

## Test-Only Smoke

When `ENABLE_TEST_ENDPOINTS=true`, a platform superadmin can run a synthetic GHL smoke for a selected workspace/sub-account:

```bash
curl -X POST \
  -H "x-workspace-id: <workspace-id>" \
  -H "x-sub-account-id: <sub-account-id>" \
  --cookie "<signed-in-session-cookie>" \
  http://localhost:3000/api/test/webhook-replay-smoke
```

The endpoint requires an existing GHL connection for that sub-account and validates:

- synthetic inbound insert is visible in `webhooks.listInbound` as `pending`;
- synchronous GHL processing moves it to `processed`;
- replay-style reset moves it back to `pending`;
- reprocessing moves it back to `processed` without creating a duplicate call.

The smoke creates durable test rows with `smoke-` external ids. Use only in development/staging/demo environments.
