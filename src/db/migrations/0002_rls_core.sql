-- Hand-written (not drizzle-generated): enables row-level security on the
-- core tenant tables and establishes the convention every later table
-- follows -- policies check the `app.current_org_id` Postgres GUC, which
-- the repository layer (Task 6 onward) sets per-connection right before
-- each query via `SET LOCAL app.current_org_id = '<uuid>'` (or
-- `set_config('app.current_org_id', '<uuid>', true)`), resolved from the
-- authenticated caller's organization at the API boundary.
--
-- These policies omit `FOR SELECT`, so by default they apply to ALL
-- commands (SELECT/INSERT/UPDATE/DELETE). For INSERT/UPDATE, Postgres
-- uses the same USING expression as the WITH CHECK when none is given
-- explicitly. Note this means inserting a brand new `organizations` row
-- requires app.current_org_id to already equal that row's (freshly
-- generated) id, which is not the case for an initial org-creation/signup
-- flow -- that bootstrap case is intentionally left for Task 6 to solve
-- (e.g. a dedicated elevated-privilege signup path), not addressed here.
--
-- RLS is enforced for every role except table owners and
-- superusers/BYPASSRLS roles (Postgres exempts them by design). The
-- `postgres` role used to run migrations and to connect as
-- TEST_DATABASE_URL is such a role, so it is NOT restricted by these
-- policies. `app_user` (see docker/test-db-init/01-app-user.sql,
-- TEST_APP_DATABASE_URL) is the non-owner, non-superuser, non-BYPASSRLS
-- role these policies are actually enforced against.
alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table creators enable row level security;

create policy org_isolation_organizations on organizations
  using (id = current_setting('app.current_org_id', true)::uuid);

create policy org_isolation_members on organization_members
  using (organization_id = current_setting('app.current_org_id', true)::uuid);

create policy org_isolation_creators on creators
  using (organization_id = current_setting('app.current_org_id', true)::uuid);
