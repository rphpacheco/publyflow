# Auth Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the six parked Auth v1 follow-ups: server-created Supabase users (so public sign-up can be turned off), POST-only logout, `/login` redirect for members, case-insensitive unique e-mail, one Supabase lookup per request, and "Supabase unavailable" kept distinct from "no access".

**Architecture:** A server-only admin module (`src/lib/auth/auth-admin.ts`) owns every Supabase admin call and is invoked after DB transactions commit. Session resolution moves to a cached `getAuthState()` that distinguishes anonymous / no-access / member and throws `AuthUnavailableError` on provider failures; API routes go through `getRouteSession()` (401/503), pages through `requireAppSession()` (renders `SessionUnavailable`). The proxy uses `getClaims()` only as an optimization.

**Tech Stack:** Next.js 16 App Router, React 19 (`cache`), `@supabase/ssr` 0.12 + `@supabase/supabase-js` 2.117 (`isAuthRetryableFetchError`, `auth.admin.createUser/listUsers`, `auth.getClaims`), Drizzle + Postgres, Vitest + Testing Library, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-06-auth-hardening-design.md` (read it first).

## Global Constraints

- Every query and join carries an explicit `organization_id` predicate inside `runInTenantContext`; never `Promise.all` inside one transaction.
- Supabase admin calls (`ensureAuthUser`, `listUsers`) never run inside a DB transaction — always after it commits.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only: never `NEXT_PUBLIC_*`, never imported by a `"use client"` file.
- Creator invite / remind / e-mail change never write `users.auth_user_id` (it locks e-mail editing). Only provisioning links, and only a user it just created.
- Portuguese copy verbatim:
  - 502 `{ error: "Não foi possível liberar o acesso agora. Tente novamente.", code: "AUTH_PROVISIONING_FAILED" }`
  - 503 `{ error: "Serviço de autenticação indisponível. Tente novamente em instantes.", code: "AUTH_UNAVAILABLE" }`
  - UI: "Não foi possível verificar sua sessão agora. Tente novamente em instantes." + button "Tentar novamente" (lucide `RefreshCw`)
  - "Sair e entrar com outra conta"
  - "Você está conectado como {email}, mas essa conta não tem acesso ao PublyFlow."
  - existing 409 "Já existe um creator com este e-mail."
- UI copy never mentions Supabase or authentication services. No emoji/symbol glyphs in UI (lucide icons only). No content overflowing containers at 320–1920px.
- Error responses: `{ error, code? }`; never raw exception text.
- Tests: `pnpm vitest run --dir src <file> --testTimeout=60000 --hookTimeout=60000`. Never run two vitest processes at once (shared test DB). Typecheck: `pnpm tsc --noEmit`. Use `/opt/homebrew/bin` on PATH.
- **Database operations (applying migrations, any SQL against dev/test/prod) are done by the controller only — never by a subagent.**

## File map

| File | Responsibility |
|---|---|
| `src/lib/auth/errors.ts` | + `AuthProvisioningError`, `AuthUnavailableError`, `isAuthServiceFailure()` |
| `src/lib/auth/auth-admin.ts` (new) | `AuthAdmin` interface, `createAuthAdmin(client)`, `getAuthAdmin()` lazy singleton |
| `src/lib/auth/provision-user.ts` | uses `AuthAdmin.ensureAuthUser`; links only what it created |
| `scripts/provision-user.ts` | builds the admin via `createAuthAdmin` |
| `src/services/creator-access.service.ts` | invite/remind call `ensureAuthUser` after commit |
| `src/services/creator.service.ts` | changeEmail calls `ensureAuthUser` after commit when the creator has a CREATOR membership |
| `src/app/api/creators/[id]/access/route.ts`, `.../access/remind/route.ts`, `src/app/api/creators/[id]/route.ts` | map `AuthProvisioningError` → 502 |
| `src/app/(auth)/login/actions.ts` | magic link `shouldCreateUser: false` |
| `src/db/schema/organizations.ts` + `src/db/migrations/0025_*.sql` | `users_email_lower_unique` |
| `scripts/backfill-auth-users.ts` (new) + `package.json` | backfill + `--check` |
| `src/lib/auth/session.ts` | `getAuthState` (React `cache`), `getSession` |
| `src/lib/auth/http.ts` | `authUnavailableResponse`, `getRouteSession` |
| `src/lib/auth/require-app-session.ts` | returns `{ status: "ok", session } \| { status: "unavailable" }` |
| `src/components/auth/session-unavailable.tsx` (new), `src/components/auth/sign-out-button.tsx` (new) | shared UI |
| `src/app/(app)/layout.tsx`, `src/app/(preview)/layout.tsx`, `src/app/(preview)/proposals/[id]/preview/page.tsx` | handle the new `requireAppSession` result |
| `src/proxy.ts` | `getClaims()`; let through on provider failure |
| 49 `src/app/api/**/route.ts` + `src/app/api/route-session-guard.test.ts` (new) | `getRouteSession()` everywhere |
| `src/app/auth/signout/route.ts`, `src/app/(auth)/sem-acesso/page.tsx`, `src/app/(auth)/login/page.tsx` | POST-only logout, no-access UI, `/login` redirect |

---

### Task 1: Auth admin module + provisioning

**Files:**
- Modify: `src/lib/auth/errors.ts`
- Create: `src/lib/auth/auth-admin.ts`, `src/lib/auth/auth-admin.test.ts`
- Modify: `src/lib/auth/provision-user.ts`, `src/lib/auth/provision-user.test.ts`, `scripts/provision-user.ts`

**Interfaces:**
- Produces:
  - `class AuthProvisioningError extends Error` (`name = "AuthProvisioningError"`, constructor `(reason: string)`, message `"Supabase admin call failed: <reason>"`) in `src/lib/auth/errors.ts`.
  - `interface EnsureAuthUserResult { authUserId: string | null; created: boolean }`
  - `interface AuthAdmin { ensureAuthUser(email: string, options?: { password?: string }): Promise<EnsureAuthUserResult>; listAuthEmails(): Promise<Set<string>> }`
  - `createAuthAdmin(client: { auth: { admin: Pick<GoTrueAdminApi, "createUser" | "listUsers"> } }): AuthAdmin`
  - `getAuthAdmin(): AuthAdmin` (throws `AuthProvisioningError("missing_service_role_key")` when the env var is absent)
  - `provisionUser(db, admin: AuthAdmin, input)` result gains `createdAuthUser: boolean`.

- [ ] **Step 1: Add the error class** — append to `src/lib/auth/errors.ts`:

```ts
export class AuthProvisioningError extends Error {
  constructor(public readonly reason: string) {
    super(`Supabase admin call failed: ${reason}`);
    this.name = "AuthProvisioningError";
  }
}
```

- [ ] **Step 2: Write the failing tests** — `src/lib/auth/auth-admin.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createAuthAdmin } from "./auth-admin";
import { AuthProvisioningError } from "./errors";

function fakeClient(overrides: { createUser?: unknown; listUsers?: unknown } = {}) {
  const createUser = vi.fn(
    (overrides.createUser as never) ?? (async () => ({ data: { user: { id: "auth-1" } }, error: null })),
  );
  const listUsers = vi.fn(
    (overrides.listUsers as never) ?? (async () => ({ data: { users: [] }, error: null })),
  );
  return { client: { auth: { admin: { createUser, listUsers } } }, createUser, listUsers };
}

describe("createAuthAdmin.ensureAuthUser", () => {
  it("creates a confirmed user without password and returns its id", async () => {
    const { client, createUser } = fakeClient();
    const admin = createAuthAdmin(client as never);
    await expect(admin.ensureAuthUser("a@publyflow.test")).resolves.toEqual({ authUserId: "auth-1", created: true });
    expect(createUser).toHaveBeenCalledWith({ email: "a@publyflow.test", email_confirm: true });
  });

  it("passes the password through when given", async () => {
    const { client, createUser } = fakeClient();
    await createAuthAdmin(client as never).ensureAuthUser("a@publyflow.test", { password: "s3nha-forte" });
    expect(createUser).toHaveBeenCalledWith({ email: "a@publyflow.test", email_confirm: true, password: "s3nha-forte" });
  });

  it.each(["email_exists", "user_already_exists"])("treats %s as success without an id", async (code) => {
    const { client } = fakeClient({ createUser: async () => ({ data: { user: null }, error: { code, status: 422 } }) });
    await expect(createAuthAdmin(client as never).ensureAuthUser("a@publyflow.test")).resolves.toEqual({
      authUserId: null,
      created: false,
    });
  });

  it("throws AuthProvisioningError on any other error", async () => {
    const { client } = fakeClient({ createUser: async () => ({ data: { user: null }, error: { code: "unexpected_failure", status: 500 } }) });
    await expect(createAuthAdmin(client as never).ensureAuthUser("a@publyflow.test")).rejects.toBeInstanceOf(AuthProvisioningError);
  });

  it("throws AuthProvisioningError when the call itself throws", async () => {
    const { client } = fakeClient({ createUser: async () => { throw new TypeError("fetch failed"); } });
    await expect(createAuthAdmin(client as never).ensureAuthUser("a@publyflow.test")).rejects.toBeInstanceOf(AuthProvisioningError);
  });
});

describe("createAuthAdmin.listAuthEmails", () => {
  it("pages through all users and lower-cases e-mails", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ email: `U${i}@X.test` }));
    const listUsers = vi
      .fn()
      .mockResolvedValueOnce({ data: { users: page1 }, error: null })
      .mockResolvedValueOnce({ data: { users: [{ email: "Last@X.test" }, { email: null }] }, error: null });
    const { client } = fakeClient({ listUsers });
    const emails = await createAuthAdmin(client as never).listAuthEmails();
    expect(emails.size).toBe(1001);
    expect(emails.has("last@x.test")).toBe(true);
    expect(listUsers).toHaveBeenNthCalledWith(1, { page: 1, perPage: 1000 });
    expect(listUsers).toHaveBeenNthCalledWith(2, { page: 2, perPage: 1000 });
  });
});
```

- [ ] **Step 3: Run to verify failure** — `pnpm vitest run --dir src src/lib/auth/auth-admin.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement** `src/lib/auth/auth-admin.ts`:

```ts
import { createClient, type GoTrueAdminApi } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { AuthProvisioningError } from "./errors";

// Server-only: the service-role key bypasses every Supabase auth rule. Never
// import this module from a "use client" file. Callers run it AFTER their DB
// transaction commits -- never inside one (external call, lock time).

export interface EnsureAuthUserResult {
  authUserId: string | null;
  created: boolean;
}

export interface AuthAdmin {
  ensureAuthUser(email: string, options?: { password?: string }): Promise<EnsureAuthUserResult>;
  listAuthEmails(): Promise<Set<string>>;
}

type AdminClient = { auth: { admin: Pick<GoTrueAdminApi, "createUser" | "listUsers"> } };

const ALREADY_EXISTS = new Set(["email_exists", "user_already_exists"]);
const PAGE_SIZE = 1000;

export function createAuthAdmin(client: AdminClient): AuthAdmin {
  return {
    async ensureAuthUser(email, options = {}) {
      let result: Awaited<ReturnType<AdminClient["auth"]["admin"]["createUser"]>>;
      try {
        result = await client.auth.admin.createUser({
          email,
          email_confirm: true,
          ...(options.password ? { password: options.password } : {}),
        });
      } catch (error) {
        throw new AuthProvisioningError((error as { name?: string }).name ?? "unknown");
      }
      const { data, error } = result;
      if (error) {
        if (error.code && ALREADY_EXISTS.has(error.code)) return { authUserId: null, created: false };
        throw new AuthProvisioningError(error.code ?? String(error.status ?? "unknown"));
      }
      if (!data.user) throw new AuthProvisioningError("no_user_returned");
      return { authUserId: data.user.id, created: true };
    },

    async listAuthEmails() {
      const emails = new Set<string>();
      for (let page = 1; ; page++) {
        const { data, error } = await client.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
        if (error) throw new AuthProvisioningError(error.code ?? "list_users_failed");
        for (const user of data.users) if (user.email) emails.add(user.email.toLowerCase());
        if (data.users.length < PAGE_SIZE) return emails;
      }
    },
  };
}

let cached: AuthAdmin | null = null;

export function getAuthAdmin(): AuthAdmin {
  if (cached) return cached;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new AuthProvisioningError("missing_service_role_key");
  const { url } = getSupabaseEnv();
  cached = createAuthAdmin(createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }));
  return cached;
}
```

If `GoTrueAdminApi` is not exported under that name, use `ReturnType<typeof createClient>["auth"]["admin"]` instead — `pnpm tsc --noEmit` decides.

- [ ] **Step 5: Run** `src/lib/auth/auth-admin.test.ts` → PASS.

- [ ] **Step 6: Update provisioning tests** — in `src/lib/auth/provision-user.test.ts` replace the fake admin and expectations:

```ts
function fakeAdmin(result: EnsureAuthUserResult = { authUserId: "77777777-7777-4777-8777-777777777777", created: true }) {
  return {
    ensureAuthUser: vi.fn(async () => result),
    listAuthEmails: vi.fn(async () => new Set<string>()),
  } satisfies AuthAdmin;
}
```

Change/add cases:
- with `password`: `expect(admin.ensureAuthUser).toHaveBeenCalledWith("raphael@publyflow.test", { password: "s3nha-forte" })`, `authUserId` linked, `createdAuthUser: true`.
- **without** `password`: `ensureAuthUser` called with `(email, { password: undefined })`, user linked (`users.auth_user_id` = returned id), `createdAuthUser: true`.
- e-mail already in Supabase (`fakeAdmin({ authUserId: null, created: false })`): not linked (`auth_user_id` null), `authUserId: null`, `createdAuthUser: false`.
- user already linked (`auth_user_id` set before): `ensureAuthUser` not called.
- `ensureAuthUser` rejects with `AuthProvisioningError`: DB rows stay committed (a re-run reuses them) and the error propagates.

Import `type AuthAdmin, type EnsureAuthUserResult` from `./auth-admin` and `AuthProvisioningError` from `./errors`.

- [ ] **Step 7: Implement** in `src/lib/auth/provision-user.ts`: remove the local `AuthAdmin` interface (re-export `export type { AuthAdmin } from "./auth-admin";` so the script import keeps working), add `createdAuthUser: boolean` to `ProvisionUserResult`, and replace the block after the transaction with:

```ts
  let authUserId = existingAuthUserId;
  let createdAuthUser = false;
  if (!authUserId) {
    const ensured = await admin.ensureAuthUser(input.email, { password: input.password });
    if (ensured.created && ensured.authUserId) {
      const linked = await UsersRepository.linkAuthUser(db, userId, ensured.authUserId);
      if (!linked) {
        throw new Error(
          `Could not link auth user ${ensured.authUserId} to user ${userId}: the row was linked concurrently to a different auth user.`,
        );
      }
      authUserId = ensured.authUserId;
      createdAuthUser = true;
    }
  }

  return { organizationId, userId, authUserId, createdUser, createdMembership, createdAuthUser };
```

- [ ] **Step 8: Update the script** `scripts/provision-user.ts`: delete the inline `admin` object and build it with `createAuthAdmin(supabase)` (import from `../src/lib/auth/auth-admin`). Update `USAGE`'s second paragraph to: `"A confirmed Supabase user is always created. Without --password, the user signs in with Google or an e-mail link (same e-mail). --password is applied only when the Supabase user is created now; an existing user's password is never changed."` After printing the result, when `values.password && !result.createdAuthUser && result.authUserId === null`, print `"Note: this e-mail already existed in Supabase; --password was not applied."` to stderr.

- [ ] **Step 9: Verify** — `pnpm vitest run --dir src src/lib/auth/auth-admin.test.ts src/lib/auth/provision-user.test.ts` → PASS; `pnpm tsc --noEmit` → clean.

- [ ] **Step 10: Commit**

```bash
git add src/lib/auth/errors.ts src/lib/auth/auth-admin.ts src/lib/auth/auth-admin.test.ts src/lib/auth/provision-user.ts src/lib/auth/provision-user.test.ts scripts/provision-user.ts
git commit -m "feat(auth): server-side Supabase user provisioning (ensureAuthUser)"
```

---

### Task 2: Creator invite / remind / e-mail change provision the Supabase user; magic link stops creating users

**Files:**
- Modify: `src/services/creator-access.service.ts`, `src/services/creator-access.service.test.ts`
- Modify: `src/services/creator.service.ts`, `src/services/creator.service.test.ts`
- Modify: `src/app/api/creators/[id]/access/route.ts` (+ `route.test.ts`), `src/app/api/creators/[id]/access/remind/route.ts` (+ `route.test.ts`), `src/app/api/creators/[id]/route.ts` (+ `route.test.ts`)
- Modify: `src/app/(auth)/login/actions.ts`, `src/app/(auth)/login/actions.test.ts`

**Interfaces:**
- Consumes: `getAuthAdmin(): AuthAdmin` (`@/lib/auth/auth-admin`), `AuthProvisioningError` (`@/lib/auth/errors`) from Task 1.
- Produces: `authProvisioningFailedResponse(): NextResponse` in `src/lib/auth/http.ts` (502 body from Global Constraints).

- [ ] **Step 1: Add the response helper** to `src/lib/auth/http.ts`:

```ts
export function authProvisioningFailedResponse(): NextResponse {
  return NextResponse.json(
    { error: "Não foi possível liberar o acesso agora. Tente novamente.", code: "AUTH_PROVISIONING_FAILED" },
    { status: 502 },
  );
}
```

- [ ] **Step 2: Failing service tests** — in `src/services/creator-access.service.test.ts` add at the top (before importing the service):

```ts
const ensureAuthUser = vi.fn(async (_email: string) => ({ authUserId: "auth-x", created: true }));
vi.mock("@/lib/auth/auth-admin", () => ({
  getAuthAdmin: () => ({ ensureAuthUser, listAuthEmails: vi.fn() }),
}));
```

Reset it in `beforeEach` (`ensureAuthUser.mockReset().mockResolvedValue({ authUserId: "auth-x", created: true })`). New cases:
- invite calls `ensureAuthUser` once with the creator's e-mail, and the creator's `users.auth_user_id` stays `null` (query the row) — e-mail stays editable.
- remind calls `ensureAuthUser` with the creator's e-mail.
- `ensureAuthUser` rejects with `new AuthProvisioningError("x")` → invite rejects with `AuthProvisioningError`, **and** the CREATOR membership row exists (committed); a second invite with `ensureAuthUser` resolving succeeds (recoverable).
- conflict errors (`CreatorAccessConflictError`) → `ensureAuthUser` not called.

In `src/services/creator.service.test.ts` add the same `vi.mock` and cases for `changeEmail`:
- creator with a CREATOR membership (invite it first via `CreatorAccessService.invite`) → after `changeEmail`, `ensureAuthUser` was last called with the **new** e-mail; `users.auth_user_id` still `null`.
- creator never invited → `ensureAuthUser` not called.
- same e-mail (case-insensitive no-op) → not called.
- transfer path (new e-mail belongs to another `users` row, creator invited) → called with the new e-mail.

- [ ] **Step 3: Run** both service test files → the new cases FAIL.

- [ ] **Step 4: Implement `CreatorAccessService`** — `invite` and `remind`: make the transaction callback return `{ instructions, email }` instead of the instructions, then after `runInTenantContext` resolves:

```ts
    const { instructions, email } = await runInTenantContext(db, orgId, async (tx) => {
      // ...unchanged body, ending with:
      return { instructions: buildAccessInstructions({ displayName: creator.displayName, email, origin }), email };
    });
    // After commit, never inside the transaction. Never links auth_user_id:
    // linking would lock e-mail editing (see isEmailEditable); the first
    // login links by verified e-mail. A failure here leaves the invite
    // committed and is recovered by inviting/reminding again.
    await getAuthAdmin().ensureAuthUser(email);
    return instructions;
```

- [ ] **Step 5: Implement `CreatorService.changeEmail`** — make the transaction return the e-mail to provision (`string | null`):
  - `return null` at the existing early return (`current.email.toLowerCase() === newEmail.toLowerCase()`);
  - same-user path: after the successful `tx.update(users)…`, `const membership = await OrganizationMembersRepository.findCreatorMembershipWithTx(tx, organizationId, current.id); return membership ? newEmail : null;`
  - transfer path: keep the existing `membership` lookup/move and end with `return membership ? newEmail : null;`
  - after `runInTenantContext`: `if (emailToProvision) await getAuthAdmin().ensureAuthUser(emailToProvision);`

- [ ] **Step 6: Run** both service test files → PASS.

- [ ] **Step 7: Routes** — in `access/route.ts` (POST only), `access/remind/route.ts` and `creators/[id]/route.ts` (PATCH) add before the deadlock check inside `catch`:

```ts
    if (error instanceof AuthProvisioningError) return authProvisioningFailedResponse();
```

Route tests: these use `importRouteWithSession(..., { extraMocks })`; pass `extraMocks: () => vi.doMock("@/lib/auth/auth-admin", () => ({ getAuthAdmin: () => ({ ensureAuthUser: ensureAuthUserMock, listAuthEmails: vi.fn() }) }))` in every setup that reaches the service (a shared helper inside each test file is fine). Add one case per route: `ensureAuthUserMock` rejects with `new AuthProvisioningError("x")` → status 502 and body `{ error: "Não foi possível liberar o acesso agora. Tente novamente.", code: "AUTH_PROVISIONING_FAILED" }`.

- [ ] **Step 8: Magic link** — in `src/app/(auth)/login/actions.ts` change `shouldCreateUser: true` to `shouldCreateUser: false` and update the expectation in `actions.test.ts` (line ~135) accordingly. Add a comment above the call: `// Public sign-up is off: only e-mails provisioned by the server (ensureAuthUser) get a link.`

- [ ] **Step 9: Verify** — run every test file touched in this task plus `src/app/(app)/creators/page.test.tsx` and `src/hooks/use-creators.test.tsx`; `pnpm tsc --noEmit`.

- [ ] **Step 10: Commit**

```bash
git add src/lib/auth/http.ts src/services/creator-access.service.ts src/services/creator-access.service.test.ts src/services/creator.service.ts src/services/creator.service.test.ts "src/app/api/creators/[id]" "src/app/(auth)/login/actions.ts" "src/app/(auth)/login/actions.test.ts"
git commit -m "feat(auth): provision Supabase users on creator invite/remind/e-mail change; magic link no longer signs up"
```

---

### Task 3: Case-insensitive unique e-mail (migration 0025)

**Files:**
- Modify: `src/db/schema/organizations.ts`
- Create: `src/db/migrations/0025_users_email_lower_unique.sql` (+ drizzle meta, generated)
- Create: `src/db/users-email-unique.test.ts`
- Modify: `src/app/api/creators/[id]/route.test.ts` (one case)

**Interfaces:** none new. `CreatorService.changeEmail` already maps any 23505 to `CreatorEmailTakenError` (409).

- [ ] **Step 1: Schema** — in `src/db/schema/organizations.ts` import `uniqueIndex` and `sql`, and give `users` a third argument:

```ts
export const users = pgTable(
  "users",
  {
    // ...columns unchanged
  },
  (table) => [uniqueIndex("users_email_lower_unique").on(sql`lower(${table.email})`)],
);
```

- [ ] **Step 2: Generate** (file generation only, no DB connection): `pnpm drizzle-kit generate --name users_email_lower_unique`. Expected: `src/db/migrations/0025_users_email_lower_unique.sql` containing `CREATE UNIQUE INDEX "users_email_lower_unique" ON "users" USING btree (lower("email"));` and nothing else. If it contains anything else, stop and report.

- [ ] **Step 3: Tests** — `src/db/users-email-unique.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { users } from "@/db/schema/organizations";

describe("users_email_lower_unique", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("rejects the same e-mail in a different case", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    await db.insert(users).values({ email: "Ana@PublyFlow.test", fullName: "Ana" });
    await expect(db.insert(users).values({ email: "ana@publyflow.test", fullName: "Ana 2" })).rejects.toMatchObject({
      cause: { code: "23505", constraint: "users_email_lower_unique" },
    });
  });
});
```

(If drizzle surfaces the pg error without `cause`, assert on the error's own `code`/`constraint` instead — check what `isUniqueViolation` in `creator.service.ts` reads.)

In `src/app/api/creators/[id]/route.test.ts` add: PATCH changing a never-logged-in creator's e-mail to an existing user's e-mail in **different case**, where that user is a creator of the same org → 409 "Já existe um creator com este e-mail.".

- [ ] **Step 4: STOP — controller applies 0025** to the local `publyflow_test` and `publyflow` databases (subagents never run DB operations). Report DONE with the migration file contents; the controller then runs the two test files.

- [ ] **Step 5: Commit** (after the controller confirms the tests pass)

```bash
git add src/db/schema/organizations.ts src/db/migrations src/db/users-email-unique.test.ts "src/app/api/creators/[id]/route.test.ts"
git commit -m "feat(db): case-insensitive unique users.email (migration 0025)"
```

---

### Task 4: Backfill script with read-only checkpoint

**Files:**
- Create: `src/lib/auth/backfill-auth-users.ts`, `src/lib/auth/backfill-auth-users.test.ts`, `scripts/backfill-auth-users.ts`
- Modify: `package.json` (script `"backfill-auth-users": "tsx --env-file=.env.local scripts/backfill-auth-users.ts"`)

**Interfaces:**
- Consumes: `AuthAdmin` (Task 1).
- Produces:
  - `checkAuthUsers(db, admin): Promise<{ missingInAuth: string[]; unlinked: number }>` — `missingInAuth` = distinct lower-cased e-mails of `users` that have at least one `organization_members` row and are not in `admin.listAuthEmails()`; `unlinked` = count of such member users with `auth_user_id IS NULL`.
  - `backfillAuthUsers(db, admin): Promise<{ created: string[]; linked: string[]; failed: string[] }>` — for each e-mail in `missingInAuth`: `ensureAuthUser(email)`; when `created` and the user has an OWNER or MANAGER membership and `auth_user_id IS NULL`, `UsersRepository.linkAuthUser`. Creators are never linked. One failing e-mail goes to `failed` and the loop continues.

These read across organizations on purpose (operator script, like provisioning); they are not tenant-scoped app code.

- [ ] **Step 1: Tests** — `src/lib/auth/backfill-auth-users.test.ts` with `withTestDb()` and a fake admin (`listAuthEmails` returns a configured set; `ensureAuthUser` a `vi.fn`). Seed: an OWNER with `auth_user_id` set and e-mail present in auth; a MANAGER without `auth_user_id`, absent from auth; a CREATOR member without `auth_user_id`, absent from auth; a `users` row with no membership, absent from auth (ignored). Cases:
  - `checkAuthUsers` → `missingInAuth` = [manager, creator] e-mails (sorted), `unlinked` = 2; writes nothing (row counts unchanged).
  - `backfillAuthUsers` → `ensureAuthUser` called for exactly those two; manager linked (`auth_user_id` = returned id), creator **not** linked; result lists both in `created`, manager in `linked`.
  - one `ensureAuthUser` rejection → that e-mail in `failed`, the other still processed.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `src/lib/auth/backfill-auth-users.ts` with two plain Drizzle queries (members joined to users, `selectDistinct`), lower-casing in SQL (`sql<string>\`lower(${users.email})\``). Sequential awaits only.

- [ ] **Step 4: Script** `scripts/backfill-auth-users.ts`: parse `--check` with `node:util` `parseArgs`; require `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (same message style as `scripts/provision-user.ts`); build the admin with `createAuthAdmin(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }))`; `getDb(databaseUrl)` and close the pool at the end like `scripts/provision-user.ts`.
  - `--check`: print `missing in auth.users (BLOCKING): <n>` followed by the e-mails, and `members without auth_user_id (informational): <n>`; exit code 1 when blocking > 0, else 0.
  - default: run `backfillAuthUsers`, print the JSON result, then run the check and print it the same way; exit 1 if `failed` is non-empty or blocking > 0.

- [ ] **Step 5: Verify** tests PASS, `pnpm tsc --noEmit` clean. Do **not** run the script against any database.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/backfill-auth-users.ts src/lib/auth/backfill-auth-users.test.ts scripts/backfill-auth-users.ts package.json
git commit -m "feat(auth): backfill Supabase users for members, with read-only --check"
```

---

### Task 5: Session core — cached auth state, unavailable handling, proxy

**Files:**
- Modify: `src/lib/auth/errors.ts`, `src/lib/auth/session.ts`, `src/lib/auth/session.test.ts`
- Modify: `src/lib/auth/http.ts`, `src/lib/auth/http.test.ts`
- Modify: `src/lib/auth/require-app-session.ts`, `src/lib/auth/require-app-session.test.ts`
- Create: `src/components/auth/session-unavailable.tsx`, `src/components/auth/session-unavailable.test.tsx`
- Modify: `src/app/(app)/layout.tsx`, `src/app/(preview)/layout.tsx`, `src/app/(preview)/proposals/[id]/preview/page.tsx` (+ its `page.test.tsx`)
- Modify: `src/proxy.ts`, `src/proxy.test.ts`

**Interfaces:**
- Produces:
  - `class AuthUnavailableError extends Error` (`name = "AuthUnavailableError"`, message `"Auth provider unavailable"`), `isAuthServiceFailure(error: unknown): boolean` — in `src/lib/auth/errors.ts`.
  - `type AuthState = { status: "anonymous" } | { status: "no-access"; email: string | null } | { status: "member"; session: Session }` and `getAuthState(): Promise<AuthState>` (React `cache`; throws `AuthUnavailableError`) — `src/lib/auth/session.ts`. `getSession()` keeps its signature (`Promise<Session | null>`) and propagates `AuthUnavailableError`.
  - `authUnavailableResponse(): NextResponse` and `getRouteSession(): Promise<Session | NextResponse>` — `src/lib/auth/http.ts`.
  - `type AppSessionResult = { status: "ok"; session: Session } | { status: "unavailable" }`; `requireAppSession(): Promise<AppSessionResult>` (redirects: anonymous → `/login`, no-access → `/sem-acesso`).
  - `SessionUnavailable` (client component, no props) — `src/components/auth/session-unavailable.tsx`.

- [ ] **Step 1: Errors** — append to `src/lib/auth/errors.ts`:

```ts
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

export class AuthUnavailableError extends Error {
  constructor() {
    super("Auth provider unavailable");
    this.name = "AuthUnavailableError";
  }
}

// Network failure or 5xx from Supabase Auth. "No session" / invalid token
// (4xx, AuthSessionMissingError) is NOT a service failure.
export function isAuthServiceFailure(error: unknown): boolean {
  if (!error) return false;
  if (isAuthRetryableFetchError(error)) return true;
  if (error instanceof TypeError) return true; // fetch failed before any response
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && status >= 500;
}
```

(Put the import at the top of the file.)

- [ ] **Step 2: Session tests** — extend `src/lib/auth/session.test.ts` (keep existing cases; the mock's `getUser` becomes configurable to return `{ data: { user: null }, error }` or to throw):
  - `getAuthState`: no user → `{ status: "anonymous" }`; provisioned user → `{ status: "member", session }`; Supabase user with no membership → `{ status: "no-access", email }`.
  - `getUser` returns `{ error: { name: "AuthRetryableFetchError", status: 0 } }` (construct a real `AuthRetryableFetchError` from `@supabase/supabase-js`: `new AuthRetryableFetchError("fetch failed", 0)`) → `getAuthState` and `getSession` reject with `AuthUnavailableError`.
  - `getUser` returns `{ error: { status: 503 } }` → `AuthUnavailableError`.
  - `getUser` throws `new TypeError("fetch failed")` → `AuthUnavailableError`.
  - `getUser` returns `{ error: { status: 401, message: "invalid" } }` → `anonymous`.

- [ ] **Step 3: Implement** `src/lib/auth/session.ts`:

```ts
import { cache } from "react";
import { db } from "@/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveSessionForAuthUser } from "./resolve-session";
import { AuthUnavailableError, UnauthenticatedError, isAuthServiceFailure } from "./errors";
import type { Session } from "./types";

export type AuthState =
  | { status: "anonymous" }
  | { status: "no-access"; email: string | null }
  | { status: "member"; session: Session };

// One Supabase getUser() per server render: layouts and pages share it.
// Authorization always comes from here (getUser + membership), never from
// JWT claims (src/proxy.ts uses getClaims() only to decide its redirect).
export const getAuthState = cache(async (): Promise<AuthState> => {
  const supabase = await createSupabaseServerClient();
  let result: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    result = await supabase.auth.getUser();
  } catch (error) {
    if (isAuthServiceFailure(error)) throw new AuthUnavailableError();
    throw error;
  }
  const { data, error } = result;
  if (error && isAuthServiceFailure(error)) throw new AuthUnavailableError();
  if (error || !data.user) return { status: "anonymous" };

  const session = await resolveSessionForAuthUser(db, {
    id: data.user.id,
    email: data.user.email ?? undefined,
    emailVerified: Boolean(data.user.email_confirmed_at),
  });
  return session ? { status: "member", session } : { status: "no-access", email: data.user.email ?? null };
});

export async function getSession(): Promise<Session | null> {
  const state = await getAuthState();
  return state.status === "member" ? state.session : null;
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new UnauthenticatedError();
  return session;
}
```

Add one test that `getUser` is called once for two `getSession()` calls **only if** React's `cache` memoizes in the Vitest environment; if it does not (React's client build makes `cache` a pass-through outside a server render), skip that assertion and note it in the report — the per-render dedupe is verified by the controller in the browser check.

- [ ] **Step 4: `getRouteSession`** — add to `src/lib/auth/http.ts`:

```ts
import { getSession } from "./session";
import { AuthUnavailableError } from "./errors";
import type { Session } from "./types";

export function authUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: "Serviço de autenticação indisponível. Tente novamente em instantes.", code: "AUTH_UNAVAILABLE" },
    { status: 503 },
  );
}

// The only way API routes read the session (enforced by
// src/app/api/route-session-guard.test.ts): 401 without a session, 503 when
// the auth provider is unavailable.
export async function getRouteSession(): Promise<Session | NextResponse> {
  try {
    return (await getSession()) ?? unauthorizedResponse();
  } catch (error) {
    if (error instanceof AuthUnavailableError) return authUnavailableResponse();
    throw error;
  }
}
```

Tests in `src/lib/auth/http.test.ts` (mock `./session` with `vi.doMock` + `vi.resetModules`): session → returns it; `null` → 401 `{ error: "Não autenticado" }`; rejects `AuthUnavailableError` → 503 with the exact body; rejects another error → rethrows.

- [ ] **Step 5: `requireAppSession`** — rewrite `src/lib/auth/require-app-session.ts`:

```ts
import { redirect } from "next/navigation";
import { getAuthState, type AuthState } from "./session";
import { AuthUnavailableError } from "./errors";
import type { Session } from "./types";

export type AppSessionResult = { status: "ok"; session: Session } | { status: "unavailable" };

/**
 * Session gate for the authenticated layouts ((app) and (preview)).
 * - member → ok
 * - Supabase user without PublyFlow access → /sem-acesso (no sign-out: logout is POST-only)
 * - no Supabase user (proxy let it through) → /login
 * - auth provider unavailable → "unavailable"; the caller renders <SessionUnavailable />
 *   (a thrown error would reach the client without its message in production).
 */
export async function requireAppSession(): Promise<AppSessionResult> {
  let state: AuthState;
  try {
    state = await getAuthState();
  } catch (error) {
    if (error instanceof AuthUnavailableError) return { status: "unavailable" };
    throw error;
  }
  if (state.status === "member") return { status: "ok", session: state.session };
  redirect(state.status === "no-access" ? "/sem-acesso" : "/login");
}
```

Rewrite `require-app-session.test.ts` (mock `./session` → `getAuthState`): member → ok; no-access → redirect `/sem-acesso`; anonymous → redirect `/login`; `AuthUnavailableError` → `{ status: "unavailable" }`; other error → rethrows.

- [ ] **Step 6: `SessionUnavailable`** — `src/components/auth/session-unavailable.tsx`:

```tsx
"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SessionUnavailable() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p role="alert" className="max-w-sm text-sm text-muted-foreground">
        Não foi possível verificar sua sessão agora. Tente novamente em instantes.
      </p>
      <Button type="button" variant="outline" onClick={() => window.location.reload()}>
        <RefreshCw aria-hidden="true" className="size-4" />
        Tentar novamente
      </Button>
    </main>
  );
}
```

Test: renders the alert text and the button; clicking calls `window.location.reload` (stub with `vi.spyOn` on a redefined `window.location` or `Object.defineProperty`); text contains no "Supabase"/"autentica".

- [ ] **Step 7: Layouts and preview page**
  - `src/app/(app)/layout.tsx`: `const result = await requireAppSession(); if (result.status === "unavailable") return <SessionUnavailable />; const { session } = result;` — rest unchanged.
  - `src/app/(preview)/layout.tsx`: same; render `<SessionUnavailable />` when unavailable.
  - `src/app/(preview)/proposals/[id]/preview/page.tsx`: `const result = await requireAppSession(); if (result.status === "unavailable") return null; const { session } = result;` (the layout renders the message). Update its `page.test.tsx` mock of `requireAppSession` to return `{ status: "ok", session }`.

- [ ] **Step 8: Proxy** — in `src/proxy.ts` replace `const { data } = await supabase.auth.getUser();` and the redirect block with:

```ts
  // getClaims() verifies the JWT locally when the project uses asymmetric
  // signing keys (falls back to a network call otherwise). It only decides
  // this redirect and refreshes cookies -- authorization still comes from
  // getSession() (getUser + membership).
  let hasUser: boolean;
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (error && isAuthServiceFailure(error)) return response; // provider down: let the page render its unavailable state
    hasUser = Boolean(data?.claims);
  } catch (error) {
    if (isAuthServiceFailure(error)) return response;
    throw error;
  }

  if (!hasUser && !isPublicPath(request.nextUrl.pathname)) {
```

(import `isAuthServiceFailure` from `@/lib/auth/errors`). Update `src/proxy.test.ts`: the `@supabase/ssr` mock exposes `getClaims` returning `{ data: user ? { claims: { sub: user.id } } : null, error: null }`; existing cases keep passing. New cases: `getClaims` returns `{ data: null, error: new AuthRetryableFetchError("fetch failed", 0) }` on `/pipeline` → no `location` header; `getClaims` throws `TypeError("fetch failed")` → no redirect; `getClaims` returns `{ data: null, error: { status: 401 } }` on `/pipeline` → redirect to `/login`.

- [ ] **Step 9: Verify** — run every test file touched, plus `pnpm tsc --noEmit` (it will list API routes only if `getSession`'s type changed — it must not have).

- [ ] **Step 10: Commit**

```bash
git add src/lib/auth src/components/auth "src/app/(app)/layout.tsx" "src/app/(preview)" src/proxy.ts src/proxy.test.ts
git commit -m "feat(auth): cached auth state; provider outage renders an unavailable state instead of no-access"
```

---

### Task 6: All API routes use `getRouteSession()` (503 on outage) + guard test

**Files:**
- Modify: every `src/app/api/**/route.ts` that calls `getSession()` (49 files — list them with `grep -rl "getSession()" src/app/api --include=route.ts`).
- Create: `src/app/api/route-session-guard.test.ts`

**Interfaces:**
- Consumes: `getRouteSession(): Promise<Session | NextResponse>` from `@/lib/auth/http` (Task 5).

- [ ] **Step 1: Guard test first** — `src/app/api/route-session-guard.test.ts`, modeled on `src/app/api/write-guard.test.ts` (same `listRouteFiles`, but scanning **all** route files including `internal/` and `public/`):

```ts
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// API routes must read the session through getRouteSession() so a Supabase
// outage answers 503 AUTH_UNAVAILABLE instead of crashing or claiming 401.
const API_ROOT = path.resolve(__dirname);

function listRouteFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listRouteFiles(full));
    else if (entry.isFile() && entry.name === "route.ts") files.push(full);
  }
  return files;
}

describe("API routes read the session through getRouteSession()", () => {
  const routeFiles = listRouteFiles(API_ROOT);

  it("found route files to check", () => {
    expect(routeFiles.length).toBeGreaterThan(10);
  });

  for (const file of routeFiles) {
    const relativePath = path.relative(API_ROOT, file).split(path.sep).join("/");
    it(`${relativePath} does not call getSession() directly`, () => {
      const source = fs.readFileSync(file, "utf8");
      expect(source).not.toMatch(/\bgetSession\s*\(/);
      expect(source).not.toMatch(/from\s+["']@\/lib\/auth\/session["']/);
    });
  }
});
```

Run it → FAIL for the 49 files.

- [ ] **Step 2: Mechanical change in each file.** Replace

```ts
  const session = await getSession();
  if (!session) return unauthorizedResponse();
```

with

```ts
  const session = await getRouteSession();
  if (session instanceof NextResponse) return session;
```

Then fix imports: drop `getSession` (and `unauthorizedResponse` if now unused) and import `getRouteSession` from `@/lib/auth/http`; make sure `NextResponse` is imported from `next/server`. Any route whose pattern differs (e.g. a block body, a different variable name, a 401 with a different message) keeps its own 401 semantics: read it, adapt by hand, and list it in the report. Do not change anything else in the handlers.

- [ ] **Step 3: Verify** — `pnpm tsc --noEmit` clean; guard test PASS; then the whole API suite: `pnpm vitest run --dir src src/app/api --testTimeout=60000 --hookTimeout=60000` → PASS (route tests mock `@/lib/auth/session`, which `getRouteSession` imports, so they keep working unchanged).

- [ ] **Step 4: One end-to-end 503 case** — in `src/app/api/companies/route.test.ts` add: `importRouteWithSession` with `extraMocks: () => vi.doMock("@/lib/auth/session", () => ({ getSession: async () => { throw new AuthUnavailableError(); } }))` → GET returns 503 with the exact `AUTH_UNAVAILABLE` body. (`extraMocks` runs after the helper's own `doMock`, so it overrides it.)

- [ ] **Step 5: Commit**

```bash
git add src/app/api
git commit -m "refactor(api): read the session via getRouteSession (503 AUTH_UNAVAILABLE on provider outage)"
```

---

### Task 7: POST-only logout, no-access screens, `/login` redirect

**Files:**
- Modify: `src/app/auth/signout/route.ts`; Create: `src/app/auth/signout/route.test.ts`
- Create: `src/components/auth/sign-out-button.tsx`, `src/components/auth/sign-out-button.test.tsx`
- Modify: `src/app/(auth)/sem-acesso/page.tsx`; Create: `src/app/(auth)/sem-acesso/page.test.tsx`
- Modify: `src/app/(auth)/login/page.tsx`; Create: `src/app/(auth)/login/page.test.tsx`
- Modify: `src/components/shell/header.tsx` (use `SignOutButton`)

**Interfaces:**
- Consumes: `getAuthState`, `AuthState` (`@/lib/auth/session`), `AuthUnavailableError` (`@/lib/auth/errors`), `SessionUnavailable` (Task 5).
- Produces: `SignOutButton({ label, variant?, size? }: { label: string; variant?: ButtonProps["variant"]; size?: ButtonProps["size"] })` — a `<form action="/auth/signout" method="post">` with a submit `Button`.

- [ ] **Step 1: Signout route tests** (`// @vitest-environment node`; mock `@/lib/supabase/server` with a `signOut` spy):
  - `POST` → `signOut` called once, status 303, `location` = `http://localhost:3000/login`.
  - `GET` (with or without `?reason=no-access`) → status 405, header `Allow: POST`, `signOut` **not** called.

- [ ] **Step 2: Implement** `src/app/auth/signout/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Logout changes state, so it is POST-only (no logout CSRF via links/images).
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", new URL(request.url).origin), { status: 303 });
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
```

- [ ] **Step 3: `SignOutButton`**:

```tsx
import { Button } from "@/components/ui/button";

type ButtonProps = React.ComponentProps<typeof Button>;

export function SignOutButton({
  label,
  variant = "outline",
  size,
}: {
  label: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  return (
    <form action="/auth/signout" method="post">
      <Button type="submit" variant={variant} size={size}>
        {label}
      </Button>
    </form>
  );
}
```

Test: renders a form with `method="post"` and `action="/auth/signout"` and a submit button with the label. In `src/components/shell/header.tsx` replace the inline form with `<SignOutButton label="Sair" variant="ghost" size="sm" />` (behavior unchanged).

- [ ] **Step 4: `/sem-acesso`** — replace the `Link` "Voltar ao login" with `<SignOutButton label="Sair e entrar com outra conta" />` (remove the `next/link` import). Keep the heading and paragraph text. Test: heading present, button present inside a POST form to `/auth/signout`, no link to `/login`.

- [ ] **Step 5: `/login` page tests** — `src/app/(auth)/login/page.test.tsx` mocking `@/lib/auth/session` (`getAuthState`) and `next/navigation` (`redirect` throws a signal, as in `require-app-session.test.ts`); render the awaited element with Testing Library (`render(await LoginPage({ searchParams: Promise.resolve({}) }))`; mock `./login-form` to a stub `<div data-testid="login-form" />` and `./actions` if needed):
  - member → redirect `/pipeline`;
  - no-access with e-mail `ana@publyflow.test` → text "Você está conectado como ana@publyflow.test, mas essa conta não tem acesso ao PublyFlow.", the "Sair e entrar com outra conta" button, and the login form;
  - anonymous → login form, no notice;
  - `getAuthState` rejects `AuthUnavailableError` → the `SessionUnavailable` alert text, no login form.

- [ ] **Step 6: Implement** `src/app/(auth)/login/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getAuthState, type AuthState } from "@/lib/auth/session";
import { AuthUnavailableError } from "@/lib/auth/errors";
import { SessionUnavailable } from "@/components/auth/session-unavailable";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  let state: AuthState;
  try {
    state = await getAuthState();
  } catch (e) {
    if (e instanceof AuthUnavailableError) return <SessionUnavailable />;
    throw e;
  }
  if (state.status === "member") redirect("/pipeline");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-xl font-semibold">Entrar no PublyFlow</h1>
      {state.status === "no-access" ? (
        <div role="status" className="flex w-full max-w-sm flex-col items-center gap-3 rounded-md border border-border p-4 text-center">
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
            Você está conectado como {state.email ?? "outra conta"}, mas essa conta não tem acesso ao PublyFlow.
          </p>
          <SignOutButton label="Sair e entrar com outra conta" />
        </div>
      ) : null}
      <LoginForm oauthError={error === "oauth"} />
    </main>
  );
}
```

(`[overflow-wrap:anywhere]` keeps long e-mails inside the box at 320px.)

- [ ] **Step 7: Verify** — all touched tests PASS; `pnpm tsc --noEmit`; `grep -rn "auth/signout?reason" src` → no matches.

- [ ] **Step 8: Commit**

```bash
git add src/app/auth/signout "src/app/(auth)" src/components/auth src/components/shell/header.tsx
git commit -m "feat(auth): POST-only logout, no-access sign-out button, /login redirects members"
```

---

### Task 8: Verification (controller)

- [ ] `pnpm tsc --noEmit`; `pnpm lint` (compare with the pre-existing baseline); full suite `pnpm vitest run --dir src --testTimeout=60000 --hookTimeout=60000`; build (command in CLAUDE.md).
- [ ] Browser (dev server, user logs in): `/login` while logged in → `/pipeline`; header "Sair" logs out; `GET /auth/signout` → 405 and still logged in; a no-access account → `/sem-acesso` with the button; `/login` with that account shows the notice; long e-mail at 320px stays inside the box.
- [ ] Outage simulation in dev: point `NEXT_PUBLIC_SUPABASE_URL` at an unreachable host (`http://127.0.0.1:9`) for one run → app pages render `SessionUnavailable` (no redirect to `/login`), an API call returns 503 `AUTH_UNAVAILABLE`. Restore the env afterwards.
- [ ] Invite a creator in dev → the Supabase dev project has the user (confirmed), `users.auth_user_id` stays null, the e-mail is still editable.
- [ ] Final whole-branch review, then merge + deploy per the spec's Deploy section (service-role key in Vercel → duplicate check + 0025 → push → backfill → `--check` blocking = 0 → user turns off sign-up → login checks → signing-keys check).
