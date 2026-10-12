do $$ declare r text; begin
  if exists (select 1 from pg_roles where rolname = 'publyflow_app' and (rolbypassrls or rolsuper or rolcanlogin)) then
    raise exception 'publyflow_app must be NOLOGIN NOSUPERUSER NOBYPASSRLS';
  end if;
  foreach r in array array['anon','authenticated','service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function publyflow_user_memberships(uuid) from %I', r);
      execute format('revoke all on function publyflow_user_is_creator_elsewhere(uuid, uuid) from %I', r);
    end if;
  end loop;
end $$;
