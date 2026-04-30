-- RLS helper functions. Read transaction-local session settings written by
-- packages/db/src/client.ts withTenant(). Returning NULL when the setting is
-- absent or empty makes the policies fail-closed (no row matches a NULL
-- workspace).
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_current_workspace_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_workspace_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_current_sub_account_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_sub_account_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_is_superadmin() RETURNS boolean AS $$
  SELECT current_setting('app.is_superadmin', true) = '1';
$$ LANGUAGE sql STABLE;
