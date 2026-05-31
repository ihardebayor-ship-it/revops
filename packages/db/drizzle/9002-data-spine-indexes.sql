-- Sprint 1 data-spine hardening. This post-schema migration is idempotent and
-- reruns with the other 9XXX operational migrations.

ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_external_uq;
ALTER TABLE optins DROP CONSTRAINT IF EXISTS optins_external_uq;
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_external_uq;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_sub_source_external_uq') THEN
    ALTER TABLE sales
      ADD CONSTRAINT sales_sub_source_external_uq UNIQUE (sub_account_id, source_integration, external_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'optins_sub_source_external_uq') THEN
    ALTER TABLE optins
      ADD CONSTRAINT optins_sub_source_external_uq UNIQUE (sub_account_id, source_integration, external_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'applications_sub_source_external_uq') THEN
    ALTER TABLE applications
      ADD CONSTRAINT applications_sub_source_external_uq UNIQUE (sub_account_id, source_integration, external_id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS memberships_user_workspace_null_sub_uq
  ON memberships (user_id, workspace_id)
  WHERE sub_account_id IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS data_source_connections_tool_external_idx
  ON data_source_connections (tool_type, external_account_id)
  WHERE external_account_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS customers_sub_lower_email_idx
  ON customers (sub_account_id, lower(primary_email))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS commission_entries_sub_recipient_status_available_idx
  ON commission_entries (sub_account_id, recipient_user_id, status, available_at);
