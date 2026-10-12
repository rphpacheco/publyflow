# RLS Enforced at Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every tenant transaction runs as the non-bypass role `publyflow_app`, so Postgres RLS policies actually isolate organizations; system paths stay privileged through a closed allow-list.

**Architecture:** Migration 0026 creates `publyflow_app` (NOLOGIN, NOBYPASSRLS), grants, membership for the connecting role, and two `SECURITY DEFINER` lookup functions for legitimate cross-organization checks. `runInTenantContext` adds `SET LOCAL ROLE publyflow_app` (kill switch `TENANT_RLS=off`). Tenant reads that currently use the root `db` move into `runInTenantContext`; a guard test keeps it that way.

**Tech Stack:** Postgres 16 RLS, Drizzle (`sql`, `drizzle-kit generate --custom`), Next.js 16 route handlers/services, Vitest against the real test Postgres.

**Spec:** `docs/superpowers/specs/2026-10-12-rls-runtime-design.md` (authoritative).

## Global Constraints

- Role name `publyflow_app`; GUC `app.current_org_id`; kill switch env `TENANT_RLS=off` (any other value or unset = enforcement on).
- `runInTenantContext` order: `set_config('app.current_org_id', …, true)` then `set local role publyflow_app` (both transaction-scoped).
- Functions: `publyflow_user_memberships(p_user_id uuid) returns table (organization_id uuid, role organization_member_role, first_login_at timestamptz)`; `publyflow_user_is_creator_elsewhere(p_user_id uuid, p_organization_id uuid) returns boolean`; both `security definer`, `set search_path = public, pg_temp`, `revoke all … from public`, `grant execute … to publyflow_app`.
- System-path allow-list (privileged, never switched): `src/lib/auth/resolve-session.ts`, `src/lib/auth/complete-recovery-login.ts`, `src/app/(auth)/login/actions.ts`, `src/app/auth/callback/route.ts`, `src/app/auth/confirm/route.ts`, `src/services/public-proposal.service.ts` and `src/services/proposal-response.service.ts` (only `findByPublicToken`), `src/services/event-drain.service.ts`, `src/app/api/internal/events/drain/route.ts`, `src/lib/rate-limit.ts`, `src/lib/auth/provision-user.ts`, `src/lib/auth/backfill-auth-users.ts`, `src/services/organization.service.ts`, `src/services/team.service.ts` (only `UsersRepository.linkAuthUser` in `provisionAuth`).
- Inside a tenant transaction, never read another organization's rows except through the two functions.
- Sequential awaits only inside a transaction (one pg connection; no `Promise.all`).
- Behavior (API responses, UI) must not change. Tests: `/opt/homebrew/bin/pnpm vitest run --dir src <files> --testTimeout=60000 --hookTimeout=60000`; never two vitest processes at once; `pnpm tsc --noEmit`.
- **Database operations (applying migrations, any SQL against dev/test/prod) are done by the controller only — never by a subagent.**

## File map

| File | Responsibility |
|---|---|
| `src/db/migrations/0026_rls_runtime_role.sql` (+ meta, custom) | role, grants, membership, functions |
| `src/repositories/organization-members.repository.ts` | `listAllForUserWithTx` (function-backed) |
| `src/repositories/creators.repository.ts` | function-backed cross-org flags / exists |
| `src/services/{team,creator-access,creator}.service.ts` | use the function-backed reads |
| `src/repositories/tenant-context.ts` | role switch + kill switch |
| `src/db/rls-runtime.test.ts`, `src/db/rls-functions.test.ts` (new) | enforcement + functions |
| ~20 services/routes (list in Tasks 3–4) | tenant reads inside `runInTenantContext` |
| `src/app/api/tenant-db-guard.test.ts` (new) | guard |

---

### Task 1: Migration 0026 + function-backed cross-organization reads

**Files:**
- Create: `src/db/migrations/0026_rls_runtime_role.sql` (via `pnpm drizzle-kit generate --custom --name rls_runtime_role`, then fill the body), `src/db/rls-functions.test.ts`
- Modify: `src/repositories/organization-members.repository.ts`, `src/repositories/creators.repository.ts`, `src/services/team.service.ts`, `src/services/creator-access.service.ts`, `src/services/creator.service.ts`

**Interfaces:**
- Produces:
  - `OrganizationMembersRepository.listAllForUserWithTx(tx, userId: string): Promise<Array<{ organizationId: string; role: "OWNER" | "MANAGER" | "CREATOR"; firstLoginAt: Date | null }>>` — `select * from publyflow_user_memberships(${userId})`.
  - `CreatorsRepository.existsForUserOutsideOrganizationWithTx(tx, userId, organizationId): Promise<boolean>` — body becomes `select publyflow_user_is_creator_elsewhere(${userId}, ${organizationId}) as v`.

- [ ] **Step 1: Generate + write the migration body** (generation writes files only; do NOT apply):

```sql
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
```

(Check the statement-breakpoint convention in an existing hand-written migration such as `src/db/migrations/0017_*` and follow it.)

- [ ] **Step 2: STOP — controller applies 0026** to `publyflow_test` and `publyflow`, then resumes you.

- [ ] **Step 3: Function tests** `src/db/rls-functions.test.ts` (connect as the test superuser for setup via `withTestDb()`; for "restricted" assertions open a transaction and run `set local role publyflow_app` + `set_config('app.current_org_id', orgA, true)` manually):
  - inside a restricted transaction for org A, `select * from publyflow_user_memberships(<user with memberships in A and B>)` returns both rows (with `first_login_at`);
  - `publyflow_user_is_creator_elsewhere(user, A)` true when the user has a creators row in B, false otherwise;
  - inside the restricted transaction, a plain `select count(*) from organization_members where user_id = …` returns only org A rows (proves the function is what crosses orgs);
  - `EXECUTE` is not granted to PUBLIC: connecting with `TEST_APP_DATABASE_URL` (`app_user`) and calling the function fails with permission denied.

- [ ] **Step 4: Switch callers** (tenant transactions only):
  - `TeamService` invite: `OrganizationMembersRepository.listForUser(tx, user.id)` → `listAllForUserWithTx(tx, user.id)`.
  - `CreatorAccessService` invite/revoke/remind: same replacement (3 places).
  - `CreatorService`: `isEmailEditable` memberships → `listAllForUserWithTx`; its `creatorElsewhere` select → `CreatorsRepository.existsForUserOutsideOrganizationWithTx`; `changeEmail` target memberships (`listForUser(tx, target.id)`) → `listAllForUserWithTx`.
  - `CreatorsRepository.listWithAccessByOrganization`: replace the three `sql` subqueries with:

```ts
const everLoggedIn = sql<boolean>`exists(select 1 from publyflow_user_memberships(${users.id}) m where m.first_login_at is not null)`;
const isTeamAnywhere = sql<boolean>`exists(select 1 from publyflow_user_memberships(${users.id}) m where m.role in ('OWNER','MANAGER'))`;
const creatorElsewhere = sql<boolean>`publyflow_user_is_creator_elsewhere(${users.id}, ${organizationId})`;
```

  - `OrganizationMembersRepository.listForUser` stays for privileged callers (session resolution); add a doc comment: "Sees other organizations only on the privileged connection; inside a tenant transaction use listAllForUserWithTx."

- [ ] **Step 5: Verify** — the service tests of team, creator-access, creator, `src/repositories/creators.repository.test.ts` (if present), `src/app/api/creators`, `src/app/api/team`, the new function tests; `pnpm tsc --noEmit`. Behavior must be unchanged (no role switch yet).

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations src/db/rls-functions.test.ts src/repositories src/services
git commit -m "feat(db): publyflow_app role and SECURITY DEFINER cross-org lookups (0026)"
```

---

### Task 2: Role switch in `runInTenantContext` + enforcement tests

**Files:**
- Modify: `src/repositories/tenant-context.ts`
- Create: `src/db/rls-runtime.test.ts`

**Interfaces:**
- Consumes: role/functions from Task 1 (already applied to the test DB).
- Produces: `runInTenantContext` enforcing RLS unless `process.env.TENANT_RLS === "off"`.

- [ ] **Step 1: Failing tests** `src/db/rls-runtime.test.ts` (`withTestDb()`, seed two orgs with companies, opportunities and memberships via existing services/fixtures):
  - `runInTenantContext(db, orgA, tx => tx.select().from(companies))` (no where) → only org A rows;
  - same for `organization_members` and `opportunities`;
  - inserting a `companies` row with `organizationId: orgB` inside org A's context rejects (RLS `WITH CHECK`);
  - with `vi.stubEnv("TENANT_RLS", "off")` the unfiltered select returns both orgs (restore env after);
  - `select current_user` inside the context is `publyflow_app` (on) / not `publyflow_app` (off).
- [ ] **Step 2: Run** → FAIL (sees both orgs).
- [ ] **Step 3: Implement**:

```ts
// Tenant transactions run as publyflow_app (no BYPASSRLS), so the org_isolation_*
// policies apply on top of the explicit organization_id predicates.
// TENANT_RLS=off is the emergency kill switch (privileged, pre-2026-10-12 behavior).
await tx.execute(sql`select set_config('app.current_org_id', ${organizationId}, true)`);
if (process.env.TENANT_RLS !== "off") {
  await tx.execute(sql`set local role publyflow_app`);
}
```

- [ ] **Step 4: Run the FULL suite once** (`pnpm vitest run --dir src --testTimeout=60000 --hookTimeout=60000`). Every failure is either (a) a cross-organization read inside a tenant transaction → convert to the Task 1 functions (add a third narrow function only if strictly needed — report it), or (b) a test that seeds/reads other orgs inside a tenant transaction → fix the test setup (seed with the root `db`, not inside another org's context). Never "fix" by removing the role switch or adding privileged paths. List every failure and its fix in the report.
- [ ] **Step 5: Verify** — full suite green; `pnpm tsc --noEmit`.
- [ ] **Step 6: Commit** — `feat(db): run tenant transactions as publyflow_app (RLS enforced, TENANT_RLS kill switch)`.

---

### Task 3: Tenant reads into `runInTenantContext` — CRM, pipeline, inbox, catalog, creators

**Files (each call below currently passes the root `db` to a repository outside a tenant transaction):**
- `src/services/crm.service.ts:35,39,43,49`
- `src/services/opportunity.service.ts:55,89,111,120,129`
- `src/services/lead.service.ts:11,19`
- `src/services/commercial-inquiry.service.ts:134,143,152,164,335`
- `src/services/brand.service.ts:10`
- `src/services/service.service.ts:38,46,54`
- `src/services/rate-card.service.ts:50,58`
- `src/services/rate-card-item.service.ts:101`
- `src/services/creator.service.ts:80,239,243` (`listByOrganization`, `listWithEmail`, `listWithAccess` — note `CreatorsRepository.listWithEmailByOrganization` / `listWithAccessByOrganization` already open their own `runInTenantContext`; only wrap calls whose repository method does not)

**Interfaces:** none new.

- [ ] **Step 1:** For each call, wrap it so the repository receives `tx`:

```ts
// before
return CrmRepository.listCompanies(db, organizationId);
// after
return runInTenantContext(db, organizationId, (tx) => CrmRepository.listCompanies(tx, organizationId));
```

If a repository method opens its own `runInTenantContext` internally (check its body), leave the call as is and note it in the report. Several calls in one service method go into ONE `runInTenantContext` with sequential awaits.
- [ ] **Step 2: Verify** — the service tests and `src/app/api` tests of these areas + `pnpm tsc --noEmit`.
- [ ] **Step 3: Commit** — `refactor(services): tenant reads run inside runInTenantContext (crm, pipeline, inbox, catalog, creators)`.

---

### Task 4: Tenant reads into `runInTenantContext` — proposals, scope, notifications

**Files:**
- `src/services/proposal.service.ts:107,115`
- `src/services/proposal-version.service.ts:64`
- `src/services/proposal-item.service.ts:170`
- `src/services/proposal-block.service.ts:113`
- `src/lib/auth/proposal-scope.ts:19` (`proposalOutOfScope`)
- `src/app/api/proposals/route.ts:58`
- `src/app/api/notifications/route.ts:9`, `src/app/api/notifications/[id]/route.ts:12`, `src/app/api/notifications/read-all/route.ts:9` (repository calls in routes → wrap in the route or move into a small service function; keep responses identical)

- [ ] **Step 1:** Same wrapping pattern as Task 3 (organization id from the session for routes). Notifications are scoped by `session.organizationId` + `session.userId`.
- [ ] **Step 2: Verify** — proposal/notification service and route tests, `src/app/(preview)` tests (scope), `pnpm tsc --noEmit`.
- [ ] **Step 3: Commit** — `refactor(services): tenant reads run inside runInTenantContext (proposals, scope, notifications)`.

---

### Task 5: Guard test

**Files:**
- Create: `src/app/api/tenant-db-guard.test.ts`

- [ ] **Step 1:** Model on `src/app/api/route-session-guard.test.ts`. Scan non-test `.ts`/`.tsx` under `src/services`, `src/app`, `src/lib` (exclude `src/lib/supabase`, `src/test`). Flag a file when it contains `/Repository\.\w+\(\s*db\s*[,)]/` or `/\bdb\.(select|insert|update|delete|execute|transaction)\(/`, unless the file is in the allow-list (Global Constraints) — the allow-list is a `Map<path, reason>` with one reason string per entry. Also assert every allow-list path exists (no stale entries). Sanity floor: more than 50 files scanned.
- [ ] **Step 2: Run** → PASS (after Tasks 3–4). If it fails, fix the offending call (wrap it), never extend the allow-list without a system-path reason; list any addition in the report.
- [ ] **Step 3: Commit** — `test: guard against tenant reads outside runInTenantContext`.

---

### Task 6: Verification and rollout (controller)

- [ ] `pnpm tsc --noEmit`; `pnpm lint` (no new errors); full suite; build.
- [ ] Browser on dev (user logs in): dashboard, pipeline, inbox (send + convert), companies/contacts (+ merge preview), creators (list access flags, invite), proposals (builder, send, public link `/p/…` + response), team page, notifications bell — nothing empty, no 500s.
- [ ] Production read-only checks: `select rolcreaterole, rolsuper from pg_roles where rolname = current_user;` and `select 1 from pg_roles where rolname = 'publyflow_app';` (must not exist or be ours). Then apply 0026, push, repeat the browser checklist in production. Rollback: `TENANT_RLS=off` in Vercel + redeploy.
- [ ] Final whole-branch review before merge.
