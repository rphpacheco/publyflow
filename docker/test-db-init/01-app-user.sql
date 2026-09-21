-- Creates a non-superuser application role for the test Postgres container.
--
-- Migrations and general test setup connect as the `postgres` superuser
-- (see TEST_DATABASE_URL). Postgres exempts superusers, roles with
-- BYPASSRLS, and table owners from row-level security policies by
-- design -- so any test that wants to prove RLS is actually enforced
-- must connect as a role that is none of those things. `app_user` is
-- that role: it never owns the tables (the `postgres` role that runs
-- migrations does), and it is explicitly NOSUPERUSER/NOBYPASSRLS.
--
-- This file is mounted into /docker-entrypoint-initdb.d/ and only runs
-- when Postgres initializes a brand new (empty) data directory. Because
-- docker-compose.test.yml uses a tmpfs data dir, that happens on every
-- `docker compose up` from a cold container, but NOT if the container
-- is merely restarted while still running. If you add/change this file
-- and the role/grants don't seem to exist, recreate the container:
--   docker compose -f docker-compose.test.yml down -v
--   docker compose -f docker-compose.test.yml up -d
create role app_user with login password 'app_user' noinherit nosuperuser nobypassrls;

grant usage on schema public to app_user;

-- Grant CRUD on tables that already exist at init time (there are none
-- on a fresh container, but this keeps the script correct if ever run
-- again against a populated schema) ...
grant select, insert, update, delete on all tables in schema public to app_user;
grant usage, select on all sequences in schema public to app_user;

-- ...and on every table/sequence created afterwards by the `postgres`
-- role (i.e. everything Drizzle migrations create), so app_user never
-- needs manual re-granting as new tables land in later tasks.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to app_user;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to app_user;
