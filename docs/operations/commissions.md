# Commission Operations

## Test-Only Ledger Smoke

When `ENABLE_TEST_ENDPOINTS=true`, a platform superadmin can run a commission ledger smoke for a selected workspace/sub-account:

```bash
curl -X POST \
  -H "content-type: application/json" \
  -H "x-workspace-id: <workspace-id>" \
  -H "x-sub-account-id: <sub-account-id>" \
  --cookie "<signed-in-session-cookie>" \
  -d '{"saleId":"<optional-sale-id>"}' \
  http://localhost:3000/api/test/commission-ledger-smoke
```

If `saleId` is omitted, the endpoint uses the latest non-deleted sale in the selected sub-account.

The endpoint validates:

- the sale has commission recipients and installments;
- synchronous recompute creates entries;
- active entries include `computedFrom.explanation` metadata;
- a second recompute preserves active entry count;
- hold-release can move a pending entry to available;
- a paid entry is not rewritten by recompute.

The endpoint temporarily mutates one entry for release and one entry for paid-lock validation, then restores their previous ledger fields. Use only in development/staging/demo environments.

## Ledger Health

The commissions page includes a ledger health card scoped to the active workspace/sub-account. It highlights:

- active non-voided ledger entries;
- stale pending entries whose `pending_until` has elapsed but have not been released;
- active entries missing `computedFrom.explanation` metadata;
- the latest tenant-scoped recompute runs.

If stale pending entries are non-zero, use the ledger health card's release action to transition eligible pending entries to available. The action is tenant-scoped and only releases entries where `pending_until` has elapsed. If missing explanations are non-zero, recompute affected sales and confirm entries were produced by the current engine. Paid and clawed-back entries are terminal ledger history and must not be rewritten by recompute.
