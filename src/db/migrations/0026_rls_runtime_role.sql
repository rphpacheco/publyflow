do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'publyflow_app') then
    create role publyflow_app nologin nosuperuser nobypassrls noinherit;
  end if;
end $$;
--> statement-breakpoint
grant usage on schema public to publyflow_app;
--> statement-breakpoint
grant select, insert, update, delete on all tables in schema public to publyflow_app;
--> statement-breakpoint
grant usage, select on all sequences in schema public to publyflow_app;
--> statement-breakpoint
alter default privileges in schema public grant select, insert, update, delete on tables to publyflow_app;
--> statement-breakpoint
alter default privileges in schema public grant usage, select on sequences to publyflow_app;
--> statement-breakpoint
grant publyflow_app to current_user;
--> statement-breakpoint
create or replace function publyflow_user_memberships(p_user_id uuid)
returns table (organization_id uuid, role organization_member_role, first_login_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$ select m.organization_id, m.role, m.first_login_at from organization_members m where m.user_id = p_user_id $$;
--> statement-breakpoint
revoke all on function publyflow_user_memberships(uuid) from public;
--> statement-breakpoint
grant execute on function publyflow_user_memberships(uuid) to publyflow_app;
--> statement-breakpoint
create or replace function publyflow_user_is_creator_elsewhere(p_user_id uuid, p_organization_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select exists(select 1 from creators c where c.user_id = p_user_id and c.organization_id <> p_organization_id) $$;
--> statement-breakpoint
revoke all on function publyflow_user_is_creator_elsewhere(uuid, uuid) from public;
--> statement-breakpoint
grant execute on function publyflow_user_is_creator_elsewhere(uuid, uuid) to publyflow_app;
