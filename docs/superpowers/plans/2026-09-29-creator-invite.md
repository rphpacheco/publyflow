# Creator Invite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agencies can invite, remind and revoke a creator's access. Creators log in with Google or a magic link using their registered e-mail. Logins record first and last access. A creator's e-mail can be corrected until its first access.

**Architecture:**
- **Data:** migration 0020 adds `first_login_at` / `last_login_at` to `organization_members`, written only at login time (password action and `/auth/callback`).
- **Service:** `CreatorAccessService` owns invite, revoke and remind. Invite is the only code path that creates a CREATOR membership. `CreatorService.changeEmail` performs the atomic e-mail fix or transfer.
- **Listing:** `CreatorsRepository.listWithAccessByOrganization` computes `access`, `lastLoginAt` and `emailEditable` in SQL.
- **Login:** a magic-link server action with a per-IP and a per-e-mail rate limit.
- **UI:** the `/creators` page and the login form get the new controls.

**Tech Stack:** Next.js 16 (server actions, route handlers), Supabase Auth (`signInWithOtp`), Drizzle + Postgres, React 19, TanStack Query, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-29-creator-invite-design.md`

## Global Constraints

- **Next.js docs:** Next.js 16 — read `node_modules/next/dist/docs/` before writing server actions, routes or pages (AGENTS.md).
- **Access status:**
  - `access` is `none` when there is no membership in this org;
  - `invited` for a CREATOR membership with `first_login_at` null;
  - `active` for a CREATOR membership with `first_login_at` not null;
  - `team` for an OWNER or MANAGER membership in this org.
  - `first_login_at` is the source of truth for "has accessed".
- **`emailEditable`** is true iff all of these hold:
  - no membership of the user (any org) has `first_login_at`;
  - `users.auth_user_id` is null;
  - the user has no OWNER/MANAGER membership in any org;
  - the user is not a creator in another org.
- **Invite:** the only code path that inserts a CREATOR membership.
- **Single-org rule:** it is temporary; keep the code comment "Temporary: remove when multi-organization sessions exist" wherever the other-org check lives.
- **Error bodies (exact):**

  | Status | Body |
  |---|---|
  | 409 | `{ "error": "Este e-mail já tem acesso a outra organização." }` |
  | 409 | `{ "error": "Esta pessoa já faz parte da equipe." }` |
  | 409 | `{ "error": "Este creator ainda não foi convidado." }` |
  | 409 | `{ "error": "Não é possível alterar o e-mail de quem já acessou o app." }` |
  | 409 | `{ "error": "Já existe um creator com este e-mail." }` |
  | 403 | `{ "error": "Sem permissão." }` |
  | 404 | `{ error: new CreatorNotFoundError(id).message }` |

- **Instructions:**
  - `loginUrl = ${origin}/login`, with `origin = new URL(request.url).origin`;
  - `message = "Olá, {displayName}! Você foi convidado(a) para acompanhar suas propostas no PublyFlow. Acesse {loginUrl} e entre com Google ou com um link enviado para {email}."`
- **Magic link:**
  - two limits, both enforced and both counted on every attempt: `scope "magic-link:ip"` 5 per 600 s keyed by `clientIp`, and `scope "magic-link:email"` 5 per 600 s keyed by the lowercased e-mail;
  - response `{ sent: true }` always, except `{ error: "Muitas tentativas. Tente novamente em alguns minutos." }` when a limit is hit;
  - `signInWithOtp({ email, options: { emailRedirectTo: \`${origin}/auth/callback\`, shouldCreateUser: true } })`.
- **UI copy:**
  - login block: `Entrar com link por e-mail`, button `Enviar link`, confirmation `Se houver acesso para este e-mail, enviamos um link. Confira sua caixa de entrada.`;
  - `/creators` column headers `Acesso` and `Último acesso`;
  - access badges `Sem acesso`, `Convite enviado`, `Ativo`, `Equipe`;
  - row actions `Convidar`, `Reenviar instruções`, `Revogar acesso`;
  - invite confirmation body `{nome} poderá entrar no PublyFlow e ver as próprias demandas, oportunidades e propostas.`, buttons `Cancelar` / `Convidar`;
  - revoke confirmation body `{nome} perderá o acesso imediatamente.`, buttons `Cancelar` / `Revogar acesso`;
  - instructions dialog title `Instruções de acesso`, buttons `Copiar mensagem` and `E-mail`;
  - toasts `Mensagem copiada.`, `Convite criado.`, `Acesso revogado.`;
  - mailto subject `Acesso ao PublyFlow`.
- **DB:** the controller applies migration 0020. Implementers never run migrations or touch any DB outside the Vitest suite.
- **Commands:**
  - pnpm: `/opt/homebrew/bin/pnpm`;
  - full suite: `/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000`;
  - build: `OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build`;
  - run everything in the foreground. Never use `git stash`.
- **Commits:** end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, whatever model you are.
- **Worktree shell:** run plain single commands; quote paths with `[id]`, `(app)`, `(auth)`.

## File Structure

| File | Responsibility |
|---|---|
| `src/db/schema/organizations.ts`, migration `0020_*` | login timestamps |
| `src/repositories/organization-members.repository.ts` | `recordLogin`, membership lookups |
| `src/app/(auth)/login/actions.ts`, `src/app/auth/callback/route.ts` | call `recordLogin`; `sendMagicLink` |
| `src/app/(auth)/login/login-form.tsx` | magic-link block |
| `src/domain/creators/errors.ts` | `CreatorAccessConflictError` |
| `src/lib/creators/access-instructions.ts` | pure message builder |
| `src/services/creator-access.service.ts` | invite, revoke, remind |
| `src/app/api/creators/[id]/access/route.ts`, `.../access/remind/route.ts` | endpoints |
| `src/repositories/creators.repository.ts` | `listWithAccessByOrganization` |
| `src/services/creator.service.ts`, `src/lib/creators/creator-input.ts`, `src/app/api/creators/[id]/route.ts` | e-mail correction |
| `src/hooks/use-creators.ts`, `src/components/creators/*`, `src/app/(app)/creators/page.tsx` | UI |

---

### Task 1: Login timestamps (migration 0020) and `recordLogin`

**Files:**
- Modify: `src/db/schema/organizations.ts` (`organizationMembers`: `firstLoginAt: timestamp("first_login_at", { withTimezone: true })`, `lastLoginAt: timestamp("last_login_at", { withTimezone: true })`, both nullable)
- Create (generated): `src/db/migrations/0020_add_member_login_timestamps.sql` + meta
- Modify: `src/repositories/organization-members.repository.ts`, `src/app/(auth)/login/actions.ts`, `src/app/auth/callback/route.ts`
- Test: `src/repositories/organization-members.repository.test.ts` (create if absent), `src/app/(auth)/login/actions.test.ts`, `src/app/auth/callback/route.test.ts`

**Interfaces:**
- Produces: `OrganizationMembersRepository.recordLogin(db, organizationId: string, userId: string, now: Date): Promise<void>`. It sets `first_login_at = coalesce(first_login_at, now)` and `last_login_at = now` on the membership with that organization and user.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/repositories/organization-members.repository.test.ts (add this describe; keep existing tests if the file exists)
import { describe, it, expect, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { organizationMembers } from "@/db/schema/organizations";
import { OrganizationMembersRepository } from "./organization-members.repository";

describe("OrganizationMembersRepository.recordLogin", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("sets first_login_at once and last_login_at every time", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const first = new Date("2026-09-29T10:00:00Z");
    const second = new Date("2026-09-30T11:00:00Z");

    await OrganizationMembersRepository.recordLogin(db, organization.id, owner.id, first);
    await OrganizationMembersRepository.recordLogin(db, organization.id, owner.id, second);

    const [member] = await db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, organization.id), eq(organizationMembers.userId, owner.id)));
    expect(member.firstLoginAt?.toISOString()).toBe(first.toISOString());
    expect(member.lastLoginAt?.toISOString()).toBe(second.toISOString());
  });
});
```

In `src/app/(auth)/login/actions.test.ts`, extend `importActions` to mock `@/repositories/organization-members.repository` with `recordLogin: recordLoginMock`. Assert that the "redirects to /pipeline" case calls `recordLoginMock` with `(expect.anything(), session.organizationId, session.userId, expect.any(Date))`, and that the `/sem-acesso` case does not call it.

In `src/app/auth/callback/route.test.ts`, use the same pattern: a successful callback records the login, and a callback that ends at `/sem-acesso` does not.

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/repositories/organization-members.repository.test.ts "src/app/(auth)/login" src/app/auth/callback`
Expected: FAIL.

- [ ] **Step 3: Schema and migration**

Add the two columns to `organizationMembers` and run `/opt/homebrew/bin/pnpm drizzle-kit generate --name add_member_login_timestamps </dev/null` (it must not prompt). The SQL must contain only the two `ALTER TABLE "organization_members" ADD COLUMN` statements.

- [ ] **Step 4: STOP**

Report NEEDS_CONTEXT with "migration 0020 generated, awaiting controller to apply" and the path. Don't commit. The controller applies it and resumes you.

- [ ] **Step 5: Implement**

```typescript
  /** Called only at login time (password action and OAuth/magic-link callback), never per request. */
  async recordLogin(db: NodePgDatabase<typeof schema>, organizationId: string, userId: string, now: Date): Promise<void> {
    await db
      .update(organizationMembers)
      .set({ firstLoginAt: sql`coalesce(${organizationMembers.firstLoginAt}, ${now})`, lastLoginAt: now })
      .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, userId)));
  },
```

In `loginWithPassword`, and in `/auth/callback` `GET`, after a non-null `session`, and before the redirect to `/pipeline`, add `await OrganizationMembersRepository.recordLogin(db, session.organizationId, session.userId, new Date());`.

- [ ] **Step 6: Run the tests, full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run src/repositories/organization-members.repository.test.ts "src/app/(auth)/login" src/app/auth/callback
/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add -A src
git commit -m "feat: record first and last login on the membership"
```

---

### Task 2: Magic-link login

**Files:**
- Modify: `src/app/(auth)/login/actions.ts`, `src/app/(auth)/login/login-form.tsx`
- Test: `src/app/(auth)/login/actions.test.ts`, `src/app/(auth)/login/login-form.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `checkRateLimit(db, { scope, ip, limit, windowSeconds })` and `clientIp(headers)` (existing, `src/lib/rate-limit.ts`, `src/lib/client-ip.ts`). `checkRateLimit`'s `ip` field is the identifier to hash; pass the lowercased e-mail for the e-mail scope.
- Produces: `export interface MagicLinkState { sent: boolean; error: string | null }` and `export async function sendMagicLink(prev: MagicLinkState, formData: FormData): Promise<MagicLinkState>`.

- [ ] **Step 1: Write the failing tests**

In `actions.test.ts`, extend `importActions` so the mocked Supabase client also exposes `signInWithOtp: signInWithOtpMock` (resolving `{ error: null }`), and mock `@/lib/rate-limit`'s `checkRateLimit` with a controllable mock (default `{ allowed: true, retryAfterSeconds: 0 }`). Then add:

```typescript
  it("sends a magic link to /auth/callback and always answers sent", async () => {
    const { sendMagicLink } = await importActions({ /* existing defaults */ });
    const form = new FormData();
    form.set("email", " Thais@Example.com ");
    expect(await sendMagicLink({ sent: false, error: null }, form)).toEqual({ sent: true, error: null });
    expect(signInWithOtpMock).toHaveBeenCalledWith({
      email: "thais@example.com",
      options: { emailRedirectTo: "http://localhost:3000/auth/callback", shouldCreateUser: true },
    });
  });

  it("still answers sent when Supabase refuses", async () => {
    signInWithOtpMock.mockResolvedValueOnce({ error: { code: "over_email_send_rate_limit" } });
    const { sendMagicLink } = await importActions({});
    const form = new FormData();
    form.set("email", "thais@example.com");
    expect(await sendMagicLink({ sent: false, error: null }, form)).toEqual({ sent: true, error: null });
  });

  it("checks both the IP and the e-mail limits, and refuses when either is exceeded", async () => {
    const { sendMagicLink } = await importActions({});
    const form = new FormData();
    form.set("email", "thais@example.com");
    await sendMagicLink({ sent: false, error: null }, form);
    expect(checkRateLimitMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scope: "magic-link:ip", limit: 5, windowSeconds: 600 }));
    expect(checkRateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope: "magic-link:email", ip: "thais@example.com", limit: 5, windowSeconds: 600 }),
    );

    checkRateLimitMock.mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0 }).mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60 });
    expect(await sendMagicLink({ sent: false, error: null }, form)).toEqual({
      sent: false,
      error: "Muitas tentativas. Tente novamente em alguns minutos.",
    });
    expect(signInWithOtpMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty e-mail", async () => {
    const { sendMagicLink } = await importActions({});
    expect(await sendMagicLink({ sent: false, error: null }, new FormData())).toEqual({ sent: false, error: "Informe seu e-mail." });
  });
```

Adapt to the file's real `importActions` option shape and mock names.

`login-form.test.tsx` (jsdom): mock `./actions` (`loginWithPassword`, `loginWithGoogle`, `sendMagicLink`). Render `<LoginForm oauthError={false} />`. Assert:
- there is a heading or label `Entrar com link por e-mail` and a `Enviar link` button;
- when `sendMagicLink` resolves `{ sent: true, error: null }` after submitting an e-mail, the confirmation text shows.

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run "src/app/(auth)/login"`

- [ ] **Step 3: Implement**

```typescript
export interface MagicLinkState {
  sent: boolean;
  error: string | null;
}

const MAGIC_LINK_WINDOW = { limit: 5, windowSeconds: 600 } as const;

export async function sendMagicLink(_prev: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { sent: false, error: "Informe seu e-mail." };

  const requestHeaders = await headers();
  const byIp = await checkRateLimit(db, { scope: "magic-link:ip", ip: clientIp(requestHeaders), ...MAGIC_LINK_WINDOW });
  const byEmail = await checkRateLimit(db, { scope: "magic-link:email", ip: email, ...MAGIC_LINK_WINDOW });
  if (!byIp.allowed || !byEmail.allowed) {
    return { sent: false, error: "Muitas tentativas. Tente novamente em alguns minutos." };
  }

  const origin = requestHeaders.get("origin") ?? "";
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback`, shouldCreateUser: true },
  });
  // Same answer either way: never reveal whether an e-mail has access.
  if (error) console.error("Magic link request failed", (error as { code?: string }).code ?? "unknown");
  return { sent: true, error: null };
}
```

Import `checkRateLimit` from `@/lib/rate-limit` and `clientIp` from `@/lib/client-ip`.

In `login-form.tsx`, below the Google form, add a separated block:

```tsx
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-sm font-medium">Entrar com link por e-mail</p>
        {magic.sent ? (
          <p role="status" className="text-sm text-muted-foreground">
            Se houver acesso para este e-mail, enviamos um link. Confira sua caixa de entrada.
          </p>
        ) : (
          <form action={magicAction} className="flex flex-col gap-2">
            <label className="sr-only" htmlFor="magic-email">E-mail para o link</label>
            <Input id="magic-email" name="email" type="email" autoComplete="email" required />
            {magic.error ? <p role="alert" className="text-sm text-error">{magic.error}</p> : null}
            <Button type="submit" variant="outline" disabled={magicPending}>
              Enviar link
            </Button>
          </form>
        )}
      </div>
```

with `const [magic, magicAction, magicPending] = React.useActionState(sendMagicLink, { sent: false, error: null });`.

- [ ] **Step 4: Run the tests, full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run "src/app/(auth)/login"
/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add "src/app/(auth)/login"
git commit -m "feat: magic-link login with per-IP and per-email rate limits"
```

---

### Task 3: Access service, endpoints and listing fields

**Files:**
- Create: `src/lib/creators/access-instructions.ts` (+ test), `src/services/creator-access.service.ts` (+ test), `src/app/api/creators/[id]/access/route.ts` (+ test), `src/app/api/creators/[id]/access/remind/route.ts` (+ test)
- Modify: `src/domain/creators/errors.ts`, `src/repositories/organization-members.repository.ts`, `src/repositories/creators.repository.ts`, `src/services/creator.service.ts`, `src/app/api/creators/route.ts` (+ test), `src/app/api/id-guard.test.ts`, `src/app/api/write-guard.test.ts` (only if the new files need the allowlist; they use `canManageOrganization`, so they shouldn't)

**Interfaces:**
- Produces:
  - `buildAccessInstructions({ displayName, email, origin }): { loginUrl: string; message: string }`;
  - `class CreatorAccessConflictError extends Error` (constructed with one of the exact 409 messages);
  - constants `ACCESS_ERRORS = { otherOrganization: "Este e-mail já tem acesso a outra organização.", team: "Esta pessoa já faz parte da equipe.", notInvited: "Este creator ainda não foi convidado." }`, exported from `src/domain/creators/errors.ts`;
  - `CreatorAccessService.invite(db, orgId, creatorId, origin): Promise<{ loginUrl; message }>`;
  - `CreatorAccessService.revoke(db, orgId, creatorId): Promise<void>`;
  - `CreatorAccessService.remind(db, orgId, creatorId, origin): Promise<{ loginUrl; message }>`;
    - all three throw `CreatorNotFoundError` for a creator outside the org and `CreatorAccessConflictError` for the 409 cases;
  - `OrganizationMembersRepository.listForUser(db, userId): Promise<Array<{ id; organizationId; role; firstLoginAt: Date | null }>>` (global, no tenant context, like `findOldestMembershipForUser`);
  - `CreatorsRepository.listWithAccessByOrganization(db, orgId): Promise<CreatorWithAccess[]>`, where `CreatorWithAccess = CreatorWithEmail & { access: "none" | "invited" | "active" | "team"; lastLoginAt: Date | null; emailEditable: boolean }`;
  - `CreatorService.listWithAccess(db, orgId)`;
  - `GET /api/creators` (OWNER/MANAGER) returns `CreatorWithAccess[]`.
- HTTP:
  - `POST /api/creators/[id]/access` → 200 `{ loginUrl, message }` | 403 | 404 | 409;
  - `DELETE /api/creators/[id]/access` → 204 | 403 | 404 | 409 (team);
  - `POST /api/creators/[id]/access/remind` → 200 `{ loginUrl, message }` | 403 | 404 | 409 (not invited).

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/creators/access-instructions.test.ts
import { describe, it, expect } from "vitest";
import { buildAccessInstructions } from "./access-instructions";

describe("buildAccessInstructions", () => {
  it("builds the login URL and the exact message", () => {
    expect(buildAccessInstructions({ displayName: "Thais", email: "thais@x.com", origin: "https://publyflow.vercel.app" })).toEqual({
      loginUrl: "https://publyflow.vercel.app/login",
      message:
        "Olá, Thais! Você foi convidado(a) para acompanhar suas propostas no PublyFlow. Acesse https://publyflow.vercel.app/login e entre com Google ou com um link enviado para thais@x.com.",
    });
  });
});
```

`src/services/creator-access.service.test.ts` (real DB). Use `seedTwoCreators` (`src/test/helpers/two-creators.ts`) or `OrganizationService.createWithOwner` plus `CreatorService.register`. Cover:
- **Invite:** creates exactly one CREATOR membership for the creator's user in the org; a second invite doesn't duplicate it.
- **Invite, other org:** the creator's user has a membership in another org → `CreatorAccessConflictError` with `ACCESS_ERRORS.otherOrganization`.
- **Invite, team:** the creator is registered with the owner's e-mail (OWNER of this org) → `ACCESS_ERRORS.team`.
- **Revoke:** removes the CREATOR membership. Afterwards `resolveSessionForAuthUser(db, { id: <authId>, email: <creator email>, emailVerified: true })` returns null. Link the user first by setting `users.auth_user_id` in the test, or call resolve once before revoking to link it.
- **Revoke, team:** throws `ACCESS_ERRORS.team` and does not delete the OWNER membership.
- **Remind:** returns instructions once invited; before inviting it throws `ACCESS_ERRORS.notInvited`.
- **Foreign creator:** a creator from another org → `CreatorNotFoundError`.
- **`listWithAccess`**, one scenario per value:
  - `none`;
  - `invited`;
  - `active` (after `recordLogin`);
  - `team` (owner as creator).

  `lastLoginAt` matches the recorded login. `emailEditable`:
  - true for a never-invited, never-linked creator;
  - false once the invite exists and `recordLogin` ran;
  - false when `auth_user_id` is set;
  - false for the team case.

Route tests (`access/route.test.ts`, `access/remind/route.test.ts`): 200 with `{ loginUrl: "http://localhost/login", message }` for OWNER, 403 for `creatorSession`, 404 for another org's creator, and 409 bodies. Add both routes to `id-guard.test.ts`:
- `creators/[id]/access` with POST and DELETE;
- `creators/[id]/access/remind` with POST;
- all with `new CreatorNotFoundError(BAD).message`.

The `/api/creators` GET test for OWNER asserts each item has `access`, `lastLoginAt` and `emailEditable`.

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/lib/creators src/services/creator-access.service.test.ts src/app/api/creators src/app/api/id-guard.test.ts`

- [ ] **Step 3: Implement**

```typescript
// src/lib/creators/access-instructions.ts
export function buildAccessInstructions(input: { displayName: string; email: string; origin: string }) {
  const loginUrl = `${input.origin}/login`;
  return {
    loginUrl,
    message: `Olá, ${input.displayName}! Você foi convidado(a) para acompanhar suas propostas no PublyFlow. Acesse ${loginUrl} e entre com Google ou com um link enviado para ${input.email}.`,
  };
}
```

Add to `src/domain/creators/errors.ts`:

```typescript
export const ACCESS_ERRORS = {
  otherOrganization: "Este e-mail já tem acesso a outra organização.",
  team: "Esta pessoa já faz parte da equipe.",
  notInvited: "Este creator ainda não foi convidado.",
} as const;

export class CreatorAccessConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreatorAccessConflictError";
  }
}
```

`CreatorAccessService` (all three methods):
1. Load the creator with `CreatorsRepository.findByIdWithTx` inside `runInTenantContext`; if missing, throw `CreatorNotFoundError(creatorId)`.
2. Load the user's e-mail.
3. Load `OrganizationMembersRepository.listForUser(db, creator.userId)`, which runs on the global `db`, outside the tenant context, like `findOldestMembershipForUser`.

- **`invite`:**
  - any membership with `organizationId !== orgId` → throw `otherOrganization`, with the comment `// Temporary: remove when multi-organization sessions exist.`;
  - a membership in this org with role ≠ CREATOR → throw `team`;
  - no CREATOR membership in this org → insert `{ organizationId, userId, role: "CREATOR" }` with `.onConflictDoNothing()`, relying on the existing unique `(organization_id, user_id)`;
  - return `buildAccessInstructions({ displayName: creator.displayName, email, origin })`.
- **`revoke`:**
  - a membership in this org with role ≠ CREATOR → throw `team`;
  - otherwise delete where `organizationId = orgId`, `userId = creator.userId` and `role = 'CREATOR'`.
- **`remind`:** throw `notInvited` if there is no CREATOR membership in this org; else return the instructions.

`listWithAccessByOrganization` (in `runInTenantContext`): extend the `listWithEmailByOrganization` query.
- **Left join** `organization_members om` on `om.user_id = creators.user_id and om.organization_id = orgId`.
- **Select:**
  - `om.role`, `om.first_login_at`, `om.last_login_at`, `users.auth_user_id`;
  - `exists(select 1 from organization_members x where x.user_id = users.id and x.first_login_at is not null) as ever_logged_in`;
  - `exists(select 1 from organization_members x where x.user_id = users.id and x.role in ('OWNER','MANAGER')) as is_team_anywhere`;
  - `exists(select 1 from creators c2 where c2.user_id = users.id and c2.organization_id <> orgId) as creator_elsewhere`.

  Use drizzle `sql` fragments.
- **Map in TypeScript:**
  - `access = !role ? "none" : role !== "CREATOR" ? "team" : firstLoginAt ? "active" : "invited"`;
  - `lastLoginAt = om.last_login_at`;
  - `emailEditable = !everLoggedIn && authUserId === null && !isTeamAnywhere && !creatorElsewhere`.

Map any `role !== "CREATOR"` to `team`.

`GET /api/creators`: for OWNER/MANAGER return `CreatorService.listWithAccess`; the CREATOR branch is unchanged.

Routes follow the existing check order: session → `isUuid` → `canManageOrganization` (403) → service. Map `CreatorNotFoundError` → 404 with its message and `CreatorAccessConflictError` → 409 `{ error: error.message }`. Get `origin` from `new URL(request.url).origin`.

- [ ] **Step 4: Run the tests, full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run src/lib/creators src/services src/app/api/creators src/app/api/id-guard.test.ts src/app/api/write-guard.test.ts
/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add -A src
git commit -m "feat: invite, remind and revoke creator access"
```

---

### Task 4: Correct a creator's e-mail before first access (atomic transfer)

**Files:**
- Modify: `src/lib/creators/creator-input.ts` (+ test), `src/services/creator.service.ts` (+ test), `src/repositories/users.repository.ts`, `src/app/api/creators/[id]/route.ts` (+ test), `src/domain/creators/errors.ts`

**Interfaces:**
- Consumes: `OrganizationMembersRepository.listForUser` (Task 3), `UsersRepository.findByEmail`/`lockByIdWithTx`, `CreatorEmailTakenError` (spec A), `ACCESS_ERRORS`, `CreatorAccessConflictError`.
- Produces:
  - `ACCESS_ERRORS.emailLocked = "Não é possível alterar o e-mail de quem já acessou o app."`;
  - `updateCreatorSchema` gains an optional `email` with the same normalisation and message as the create schema;
  - `CreatorService.changeEmail(db, orgId, creatorId, newEmail): Promise<void>`;
  - `PATCH /api/creators/[id]` applies `email` when present and different.

- [ ] **Step 1: Write the failing tests**

In `src/services/creator.service.test.ts`, add a `describe("CreatorService.changeEmail")` covering:
- **Fresh e-mail:** a never-accessed creator with a fresh e-mail updates `users.email` on the same `users` row.
- **Same e-mail:** the same e-mail (different case) → no change, no error.
- **Locked:** a creator whose membership has `first_login_at` set (invite, then `recordLogin`) → `CreatorAccessConflictError(ACCESS_ERRORS.emailLocked)`. Also locked when `users.auth_user_id` is set.
- **Target in another org:** the target e-mail belongs to a user with a membership in another org → `otherOrganization`.
- **Target already a creator here:** `CreatorEmailTakenError`.
- **Target is team here:** the target is OWNER in this org → `ACCESS_ERRORS.team`.
- **Transfer invariant:**
  1. create a creator and invite it (CREATOR membership on user A);
  2. insert a bare `users` row B with the target e-mail and no memberships;
  3. call `changeEmail`;
  4. assert `creators.user_id === B.id`;
  5. assert there is **exactly one** CREATOR membership in the org among A and B, and it belongs to B;
  6. assert its `id` is the same membership row id as before (moved, not recreated);
  7. assert A has no memberships.
- **Atomicity:** same setup, but `vi.spyOn(OrganizationMembersRepository, "moveMembershipWithTx").mockRejectedValueOnce(new Error("boom"))` → `changeEmail` rejects. Then `creators.user_id` is still A and A still has its CREATOR membership, with the same id.

Route test (`src/app/api/creators/[id]/route.test.ts`): PATCH with `email` returns 200 and the e-mail changes; the locked case returns 409 with `emailLocked`; a PATCH without `email` behaves as before.

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/services/creator.service.test.ts src/lib/creators "src/app/api/creators"`

- [ ] **Step 3: Implement**

- **Schema:** `updateCreatorSchema = z.object({ displayName, instagramHandle, email: emailSchema.optional() })`. Reuse the create schema's e-mail piece by extracting it into a const `email`. Keep the existing "ignores e-mail" test semantics only where the API still ignores it, and update that test to the new contract: an e-mail present is now parsed.
- **Repositories:**
  - `OrganizationMembersRepository.moveMembershipWithTx(tx, membershipId: string, newUserId: string)`: `update organization_members set user_id = newUserId where id = membershipId`;
  - `findCreatorMembershipWithTx(tx, orgId, userId)`: returns the CREATOR membership row or null.
- **`CreatorService.changeEmail`** (one `runInTenantContext` transaction):
  1. load the creator (org-scoped) and throw `CreatorNotFoundError` if missing;
  2. lock the current user with `UsersRepository.lockByIdWithTx`;
  3. if the normalised new e-mail equals the current one, return;
  4. check editability with the §Global Constraints rule, querying inside `tx`; if not editable, throw `emailLocked`;
  5. look up the target with `UsersRepository.findByEmail(tx, newEmail)`;
  6. no target: `update users set email = newEmail where id = current.id`. A unique violation (race) maps to `CreatorEmailTakenError`;
  7. target exists: lock it (`lockByIdWithTx`) and read its memberships. Throw `otherOrganization` if it has one in another org (with the Temporary comment), `team` if it has any membership in this org, and `CreatorEmailTakenError` if a creator row exists for it in this org;
  8. then, still in `tx`: `update creators set user_id = target.id where id = creatorId and organization_id = orgId`. If `findCreatorMembershipWithTx(tx, orgId, current.id)` returns a row, call `moveMembershipWithTx(tx, row.id, target.id)`.
- **`PATCH /api/creators/[id]`:**
  - after validation, if `parsed.data.email` is present, call `CreatorService.changeEmail` first, then the existing display update;
  - map `CreatorAccessConflictError` → 409 `{ error: message }` and `CreatorEmailTakenError` → 409 `{ error: message }`;
  - the response is the updated creator.

- [ ] **Step 4: Run the tests, full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run src/services src/lib/creators src/app/api/creators
/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add -A src
git commit -m "feat: correct a creator's e-mail before first access with an atomic membership transfer"
```

---

### Task 5: `/creators` access UI

**Files:**
- Modify: `src/hooks/use-creators.ts` (+ test), `src/app/(app)/creators/page.tsx` (+ test), `src/components/creators/creator-form-dialog.tsx` (+ test)
- Create: `src/components/creators/access-instructions-dialog.tsx` (+ test), `src/components/creators/creator-access-actions.tsx` (+ test)

**Interfaces:**
- Consumes: the Task 3 and Task 4 HTTP contracts; `ApiError` (`.status`, `.message`, `.body`); `useSessionRole`/`useIsCreator` (the page already redirects CREATOR).
- Produces:
  - `CreatorDto` gains `access: "none" | "invited" | "active" | "team"`, `lastLoginAt: string | null` and `emailEditable: boolean`;
  - hooks `useInviteCreator()`, `useRevokeCreatorAccess()` and `useRemindCreatorAccess()`. Each mutation takes `creatorId` and invalidates `creatorsQueryKey` on settle. Invite and remind return `{ loginUrl, message }`;
  - `useUpdateCreator(creatorId)` accepts `{ displayName; instagramHandle; email?: string }`;
  - `AccessInstructionsDialog({ open, onOpenChange, email, message })`;
  - `CreatorAccessActions({ creator, onInstructions })`.

- [ ] **Step 1: Write the failing tests**
- **Hooks:** invite POSTs `/api/creators/c1/access`; revoke DELETEs it; remind POSTs `/api/creators/c1/access/remind`; each invalidates `creatorsQueryKey`.
- **`CreatorAccessActions`** (hooks mocked):
  - `access: "none"` → a `Convidar` button opens a confirmation with `Thais poderá entrar no PublyFlow e ver as próprias demandas, oportunidades e propostas.`. Confirming calls invite, shows toast `Convite criado.`, and calls `onInstructions({ email, message })` with the returned message.
  - `invited`/`active` → `Reenviar instruções` calls remind and then `onInstructions`. `Revogar acesso` opens a confirmation with `Thais perderá o acesso imediatamente.`; confirming calls revoke and shows toast `Acesso revogado.`.
  - `team` → no access buttons.
  - A 409 `ApiError` → `toast.error(error.message)`.
- **`AccessInstructionsDialog`:**
  - it shows the title `Instruções de acesso` and the message in a read-only textarea;
  - `Copiar mensagem` writes it to the clipboard and shows toast `Mensagem copiada.`;
  - `E-mail` is a link with `href` `mailto:thais@x.com?subject=Acesso%20ao%20PublyFlow&body=<encoded message>`.
- **Page:**
  - column headers `Acesso` and `Último acesso`;
  - badges map `none/invited/active/team` → `Sem acesso/Convite enviado/Ativo/Equipe`;
  - `Último acesso` shows the pt-BR short date or `—`;
  - each row renders `CreatorAccessActions`.
- **Form dialog in edit mode:**
  - the e-mail input is enabled when `emailEditable` is true and disabled otherwise;
  - saving with a changed e-mail sends `email` in the PATCH, and an unchanged one doesn't send it;
  - a 409 appears under E-mail.

- [ ] **Step 2: Run them to see them fail**

Run: `/opt/homebrew/bin/pnpm vitest run src/hooks/use-creators.test.tsx src/components/creators "src/app/(app)/creators"`

- [ ] **Step 3: Implement**

```tsx
// src/components/creators/access-instructions-dialog.tsx
"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export function AccessInstructionsDialog({
  open,
  onOpenChange,
  email,
  message,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  message: string;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      toast.success("Mensagem copiada.");
    } catch {
      toast.error("Não foi possível copiar a mensagem.");
    }
  }
  const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Acesso ao PublyFlow")}&body=${encodeURIComponent(message)}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Instruções de acesso</DialogTitle>
        </DialogHeader>
        <Textarea readOnly value={message} rows={5} aria-label="Mensagem de acesso" />
        <div className="flex gap-2">
          <Button type="button" onClick={copy}>Copiar mensagem</Button>
          <Button asChild variant="outline">
            <a href={mailto}>E-mail</a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

`encodeURIComponent` turns `@` into `%40` in the address, which the share-links helper already accepts as RFC-compliant. The test must assert the exact encoded `href` this produces: `mailto:thais%40x.com?...`. Update the test expectation above accordingly, and keep the code as written.

`CreatorAccessActions` uses the existing `AlertDialog*` components for both confirmations, with the exact copy from the Global Constraints. On invite or remind success it calls `onInstructions({ email: creator.email, message })`. The page holds `instructions` state and renders one `AccessInstructionsDialog`.

Page table: add `Acesso` (a `Badge` from `@/components/ui/badge` with the mapped label) and `Último acesso` (`creator.lastLoginAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(creator.lastLoginAt)) : "—"`) columns before the actions. Put `<CreatorAccessActions>` next to the existing `Editar` button.

Form dialog: in edit mode, keep the e-mail input `disabled={!creator.emailEditable}`. On save, include `email` only when it differs from `creator.email`, compared lowercased and trimmed.

- [ ] **Step 4: Run the tests, full suite, build, commit**

```bash
/opt/homebrew/bin/pnpm vitest run src/hooks src/components/creators "src/app/(app)/creators"
/opt/homebrew/bin/pnpm vitest run --testTimeout=60000 --hookTimeout=60000
OPENAI_API_KEY=test JEV_API_KEY=test NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=test /opt/homebrew/bin/pnpm build
git add -A src
git commit -m "feat: creator access actions and instructions on the creators page"
```

---

## Real verification (controller + user, after Task 5)

On the local dev DB and the worktree dev server:
1. As OWNER, create a creator with an e-mail the user receives: ask the user which one, e.g. `rphpacheco+creator@gmail.com`.
2. Give that creator an opportunity and a proposal so there is something to see, via SQL on the **local dev DB only**, mirroring `seedTwoCreators`.
3. Invite it and check the instructions dialog.
4. In a separate browser context (the pane's second tab won't do, because it shares cookies), the user requests the magic link and opens it. Alternative: the OWNER signs out in the pane and the user logs in there as the creator.
5. Verify the CREATOR view:
   - the sidebar has only Inbox, Pipeline and Proposals;
   - the switcher is a fixed label;
   - the Pipeline is read-only;
   - the proposal opens the read view;
   - `/creators` redirects.
6. As OWNER again, check `Ativo` and `Último acesso`.
7. Revoke, then check that the creator's next navigation lands on `/sem-acesso`.

## Deploy

1. The controller applies migration 0020 to production.
2. The user configures the Supabase SMTP with Resend. The controller guides this.
3. Push.

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §3 migration | 1 |
| §4.1 magic link and both limits | 2 |
| §4.2 `recordLogin` | 1 |
| §5.1–5.4 invite, revoke, remind, message | 3 |
| §5.5 listing fields | 3 |
| §5.5 e-mail correction and transfer invariant | 4 |
| §6 UI | 5 |
| §7 tests | 1–5 plus real verification |
| §8 deploy | Deploy section |
| §2 single-org rule marked temporary | 3 and 4 (comment) |

**Placeholder scan:** the only adaptation note is the login-test mock shape, and the assertions stay fixed.

**Type consistency:**

| Name | Defined in | Used in |
|---|---|---|
| `recordLogin` | Task 1 | Task 1 and the real verification |
| `listForUser` | Task 3 | Task 4 |
| `ACCESS_ERRORS`, `CreatorAccessConflictError` | Task 3 | Tasks 4 and 5 (via HTTP) |
| `CreatorWithAccess` fields | Task 3 | Task 5's `CreatorDto` |
| `moveMembershipWithTx` | Task 4 | Task 4 |
