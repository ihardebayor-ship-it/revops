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
