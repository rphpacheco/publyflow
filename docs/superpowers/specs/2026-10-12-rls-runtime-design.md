# Row-level security enforced at runtime (TAREFA item G)

Date: 2026-10-12. Status: approved design (user, 2026-10-12), pending written-spec review.
Origin: Auth v1 subproject 4. RLS policies `org_isolation_*` exist on 25 tables (keyed on `app.current_org_id`, set by `runInTenantContext`), but the app connects as `postgres` (local and Supabase), which bypasses RLS. Today the tenant boundary is only the explicit `organization_id` predicate in every query; only `src/db/rls-*.test.ts` exercise the policies (as `app_user`).

## 1. Decisions

| # | Decision |
|---|---|
| D1 | **Role switch inside tenant transactions.** `runInTenantContext` runs `SET LOCAL ROLE publyflow_app` (a role without BYPASSRLS) in addition to `set_config('app.current_org_id', …, true)`. Everything inside a tenant transaction is subject to RLS. No new connection, password, env URL or pooler change. |
| D2 | **System paths stay privileged, explicitly.** Cross-tenant work keeps the current connection without the role switch, from a closed, commented allow-list (§3.4). |
| D3 | **All tenant reads move into `runInTenantContext` in this round** (~40 calls that use `db` outside a tenant transaction today). A guard test forbids repository calls with the root `db` in services/routes outside the allow-list. |
| D4 | **Cross-organization lookups that tenant code legitimately needs** (invite conflict checks) become narrow `SECURITY DEFINER` SQL functions callable from the restricted role; inside the restricted transaction there is no way back to the privileged role. |
| D5 | **Kill switch:** env `TENANT_RLS=off` skips the `SET LOCAL ROLE` (today's behavior) — a Vercel env change + redeploy, no code revert. Default: on. |

## 2. Migration 0026 (`pnpm drizzle-kit generate --custom --name rls_runtime_role`, body hand-written)

```sql
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'publyflow_app') then
    create role publyflow_app nologin nosuperuser nobypassrls noinherit;
  end if;
end $$;
grant usage on schema public to publyflow_app;
grant select, insert, update, delete on all tables in schema public to publyflow_app;
grant usage, select on all sequences in schema public to publyflow_app;
alter default privileges in schema public grant select, insert, update, delete on tables to publyflow_app;
alter default privileges in schema public grant usage, select on sequences to publyflow_app;
grant publyflow_app to current_user;  -- the migrating/connecting role (postgres) may SET ROLE to it
```

Plus the functions (owned by the migrating role, `security definer`, `set search_path = public, pg_temp`, `revoke all … from public`, `grant execute … to publyflow_app`):
- `publyflow_user_memberships(p_user_id uuid) returns table (organization_id uuid, role organization_member_role, first_login_at timestamptz)` — all memberships of that user (used by the team invite and creator access/e-mail-change conflict checks, and by the creators list's `everLoggedIn` / `isTeamAnywhere` flags).
- `publyflow_user_is_creator_elsewhere(p_user_id uuid, p_organization_id uuid) returns boolean` — exists a `creators` row for the user outside the organization.

Notes:
- Tables without RLS enabled (`users`, `rate_limit_buckets`, Drizzle's own) remain fully readable by `publyflow_app`; that is intended (`users` is global).
- Policies without `TO` apply to `PUBLIC`, so they bind `publyflow_app`. Tables are owned by the migrating role; `publyflow_app` is not the owner, so RLS applies without `FORCE`.
- `organizations` policy (`id = current_org_id`) already allows reading the session's own organization (org name in invite messages).
- Before applying in production (read-only): check that the connecting role can `create role` and `grant … to current_user` on Supabase (`select rolcreaterole from pg_roles where rolname = current_user`). If not, stop and report (no workaround without the user).

## 3. Code changes

### 3.1 `runInTenantContext` (`src/repositories/tenant-context.ts`)
```ts
await tx.execute(sql`select set_config('app.current_org_id', ${organizationId}, true)`);
if (process.env.TENANT_RLS !== "off") await tx.execute(sql`set local role publyflow_app`);
```
`organizationId` must be a UUID (already validated upstream); behavior otherwise unchanged.

### 3.2 Cross-organization checks
Replace, inside tenant transactions, the direct reads that must see other organizations:
- `OrganizationMembersRepository.listForUser(tx, userId)` → new `OrganizationMembersRepository.listAllForUserWithTx(tx, userId)` calling `publyflow_user_memberships` (used by `TeamService` invite, `CreatorAccessService`, `CreatorService` e-mail-editable / change-e-mail checks). Callers outside tenant transactions (session resolution) keep the plain query.
- `CreatorsRepository.existsForUserOutsideOrganizationWithTx` → `publyflow_user_is_creator_elsewhere`.
- `CreatorService.isEmailEditable`'s "creator elsewhere" query → same function.
- `CreatorsRepository.listWithAccessByOrganization` subqueries `everLoggedIn`, `isTeamAnywhere` (memberships of any org) and `creatorElsewhere` (creators of other orgs) → expressed over the two functions (e.g. `exists(select 1 from publyflow_user_memberships(users.id) m where m.first_login_at is not null)`).
- Any other cross-organization read inside a tenant transaction found when the full suite runs with the role switch is converted the same way (no new privileged paths).
Every other read inside a tenant transaction is own-organization by design and keeps working under RLS.

### 3.3 Tenant reads outside a transaction
Every service/route call that reads tenant data with the root `db` (e.g. `Repository.x(db, organizationId, …)` in opportunity, commercial-inquiry, crm, service, creator, rate-card, proposal, lead, team, rate-card-item, proposal-version/-item/-block, brand, dashboard, notifications, proposal scope, `/api/proposals`, `/api/notifications`) runs inside `runInTenantContext(db, organizationId, (tx) => …)`. Sequential awaits only (one connection per transaction).

### 3.4 System paths (privileged, not switched) — the allow-list
1. Session: `src/lib/auth/resolve-session.ts`, `recordLogin` in login/callback/confirm (`src/lib/auth/complete-recovery-login.ts`, `src/app/(auth)/login/actions.ts`, `src/app/auth/callback/route.ts`).
2. Public token lookups: `ProposalsRepository.findByPublicToken` in `public-proposal.service.ts` / `proposal-response.service.ts` (the rest of those flows already runs in a tenant transaction).
3. Event drain and cron: `src/services/event-drain.service.ts` (claims events across organizations) and its handlers.
4. Rate limit: `src/lib/rate-limit.ts`.
5. Provisioning/operator scripts: `src/lib/auth/provision-user.ts`, `src/lib/auth/backfill-auth-users.ts`, `OrganizationService` (org creation), `scripts/*`.
6. Supabase user linking after commit: `UsersRepository.linkAuthUser` in team/provisioning (global `users` table).
In these paths the protection remains the explicit `organization_id` predicate (or the public token).

### 3.5 Guard test
`src/app/api/tenant-db-guard.test.ts` (pattern of `route-session-guard.test.ts`): scans non-test files under `src/services`, `src/app`, `src/lib` and fails when a repository method is called with the root `db` (`Repository.<method>(db` or `db.select|insert|update|delete|execute(`) outside the allow-list files above. The allow-list lives in the test with one comment per entry.

## 4. Tests
- Full suite runs with the role switch on (tests call `runInTenantContext` like production), so it exercises RLS end to end.
- New `src/db/rls-runtime.test.ts`: inside `runInTenantContext` for org A, a deliberately unfiltered `select` on `companies`/`opportunities`/`organization_members` returns only org A rows; insert of a row for org B fails (policy); with `TENANT_RLS=off` the same unfiltered select sees both orgs (kill switch works).
- Functions: `publyflow_user_memberships` returns memberships of all orgs from inside a restricted transaction; `publyflow_user_is_creator_elsewhere` true/false cases; `EXECUTE` denied to `PUBLIC` (call as `app_user` without grant fails).
- Team invite / creator access / e-mail change conflict tests (`OTHER_ORGANIZATION`, `emailEditable`) keep passing under RLS.
- Guard test.

## 5. Deploy
1. Read-only checks in production: role capabilities (§2), existing role name not taken.
2. Apply 0026 in production (role + grants + functions only; old code unaffected — it never switches role).
3. Push `main`; verify login, dashboard, pipeline, proposals, team, public proposal link, inbox conversion, notifications.
4. If anything shows empty or fails with "permission denied": set `TENANT_RLS=off` in Vercel and redeploy, then investigate.

## 6. Out of scope
Separate restricted connection (option B, two DB URLs); running the event drain under per-event tenant context; RLS on `users`; FORCE RLS for owners.
