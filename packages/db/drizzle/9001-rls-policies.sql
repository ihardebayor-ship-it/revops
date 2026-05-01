-- ╭─────────────────────────────────────────────────────────────────╮
-- │ Phase 0 Hardening — Row-Level Security                          │
-- │                                                                 │
-- │ Creates the revops_app role used by the runtime, enables RLS    │
-- │ on every tenant table, and adds a tenant_isolation policy. The  │
-- │ migration runner uses neondb_owner (superuser) so this script   │
-- │ can grant permissions to a less-privileged role for the app.    │
-- │                                                                 │
-- │ Policy categories:                                              │
-- │   - direct          tables with workspace_id (or 'id' on        │
-- │                     workspaces) — scoped directly                │
-- │   - via_parent      child tables without workspace_id — scoped  │
-- │                     by EXISTS over their parent table            │
-- │   - audit_log       nullable workspace_id — superadmin sees     │
-- │                     NULL workspace; tenants see their workspace │
-- │   - platform_only   superadmin-only                             │
-- ╰─────────────────────────────────────────────────────────────────╯

-- ─── 1. App role ─────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'revops_app') THEN
    EXECUTE format(
      'CREATE ROLE revops_app LOGIN PASSWORD %L NOBYPASSRLS NOSUPERUSER',
      current_setting('revops.app_password')
    );
  END IF;
  -- On re-run: only the password is re-applied (Neon restricts ALTER ROLE
  -- for non-password attributes; the role is already NOBYPASSRLS NOSUPERUSER
  -- from creation). Idempotent.
  EXECUTE format(
    'ALTER ROLE revops_app WITH PASSWORD %L',
    current_setting('revops.app_password')
  );
END $$;

GRANT CONNECT ON DATABASE neondb TO revops_app;
GRANT USAGE ON SCHEMA public TO revops_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO revops_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO revops_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO revops_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO revops_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO revops_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO revops_app;

-- ─── 2. Enable RLS + add policies ────────────────────────────────
DO $rls$
DECLARE
  -- direct: tables that carry workspace_id directly.
  direct_tables text[] := ARRAY[
    -- workspace_only (no sub_account_id)
    'sub_accounts', 'memberships', 'workspace_settings', 'tenant_settings',
    'sales_roles', 'sales_role_assignments',
    'funnel_stages', 'funnel_event_dedupe',
    'dispositions', 'customers',
    'commission_rules', 'commission_periods',
    'commission_recompute_runs',
    'goals',
    'data_sources',
    'agent_threads', 'agent_facts',
    'outbound_webhook_subscriptions',
    -- workspace_and_sub
    'calls', 'sales', 'payment_plans',
    'commission_entries', 'commission_recipients',
    'funnel_events', 'tasks',
    'applications', 'optins',
    'data_source_connections'
  ];

  -- via_parent: scoped via a parent table that has workspace_id.
  -- Format: { child, parent_table, fk_column_on_child }
  via_parent_specs text[][] := ARRAY[
    ARRAY['sales_role_versions',     'sales_roles',       'sales_role_id'],
    ARRAY['funnel_stage_versions',   'funnel_stages',     'funnel_stage_id'],
    ARRAY['commission_rule_versions','commission_rules',  'commission_rule_id'],
    ARRAY['payment_plan_installments','sales',            'sale_id'],
    ARRAY['agent_messages',          'agent_threads',     'thread_id']
  ];

  t text;
  spec text[];
  child_table text;
  parent_table text;
  fk_col text;
BEGIN
  -- 2a. Direct policies
  FOREACH t IN ARRAY direct_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = app_current_workspace_id() OR app_is_superadmin())
        WITH CHECK (workspace_id = app_current_workspace_id() OR app_is_superadmin())
    $p$, t);
  END LOOP;

  -- 2b. Via-parent policies
  FOREACH spec SLICE 1 IN ARRAY via_parent_specs LOOP
    child_table := spec[1];
    parent_table := spec[2];
    fk_col := spec[3];
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', child_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', child_table);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', child_table);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (
          app_is_superadmin()
          OR EXISTS (
            SELECT 1 FROM %I p
            WHERE p.id = %I.%I
              AND p.workspace_id = app_current_workspace_id()
          )
        )
        WITH CHECK (
          app_is_superadmin()
          OR EXISTS (
            SELECT 1 FROM %I p
            WHERE p.id = %I.%I
              AND p.workspace_id = app_current_workspace_id()
          )
        )
    $p$, child_table, parent_table, child_table, fk_col, parent_table, child_table, fk_col);
  END LOOP;

  -- 2b-bis. installment_status_history → via payment_plan_installments → sales.
  ALTER TABLE installment_status_history ENABLE ROW LEVEL SECURITY;
  ALTER TABLE installment_status_history FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON installment_status_history;
  CREATE POLICY tenant_isolation ON installment_status_history
    USING (
      app_is_superadmin()
      OR EXISTS (
        SELECT 1
        FROM payment_plan_installments i
        JOIN sales s ON s.id = i.sale_id
        WHERE i.id = installment_status_history.installment_id
          AND s.workspace_id = app_current_workspace_id()
      )
    )
    WITH CHECK (
      app_is_superadmin()
      OR EXISTS (
        SELECT 1
        FROM payment_plan_installments i
        JOIN sales s ON s.id = i.sale_id
        WHERE i.id = installment_status_history.installment_id
          AND s.workspace_id = app_current_workspace_id()
      )
    );

  -- 2c. workspaces: scope by id, not workspace_id.
  ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
  ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON workspaces;
  CREATE POLICY tenant_isolation ON workspaces
    USING (id = app_current_workspace_id() OR app_is_superadmin())
    WITH CHECK (id = app_current_workspace_id() OR app_is_superadmin());

  -- 2d. audit_log: nullable workspace_id; non-null rows must match,
  --     NULL rows visible only to superadmin.
  ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
  ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON audit_log;
  CREATE POLICY tenant_isolation ON audit_log
    USING (
      app_is_superadmin()
      OR (workspace_id IS NOT NULL AND workspace_id = app_current_workspace_id())
    );

  -- 2e. Platform-only tables: superadmin gets all access; tenants get nothing.
  --     agent_eval_runs is platform-scoped (no per-workspace evals in MVP).
  FOREACH t IN ARRAY ARRAY['platform_settings', 'platform_users', 'agent_eval_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_admin ON %I', t);
    EXECUTE format($p$
      CREATE POLICY platform_admin ON %I
        USING (app_is_superadmin())
        WITH CHECK (app_is_superadmin())
    $p$, t);
  END LOOP;
END
$rls$;

-- Better Auth tables (user, session, account, verification): NOT RLS'd.
-- Better Auth queries them with the app role; tenant isolation is via
-- memberships, which IS RLS'd.

-- ─── 3. Sanity ───────────────────────────────────────────────────
SELECT 'rls_enabled_tables' AS metric, count(*) AS n
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true;
