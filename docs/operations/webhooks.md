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

Use the migration/owner database URL for inspection. Do not log raw payloads in shared channels.

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

## Tenant Safety Checks

- Idempotency key is `(source, provider_account_id, external_id)`.
- GHL `provider_account_id` is the GHL `locationId`.
- Aircall `provider_account_id` is Aircall `data.user.id`.
- Fathom `provider_account_id` is derived from a signed local webhook scope key.
- Processors resolve tenant context before writes and run writes through `withTenant`.
