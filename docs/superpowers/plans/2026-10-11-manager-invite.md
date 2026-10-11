# Team Page and Manager Invite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An "Equipe" page (`/team`) where the OWNER invites, re-sends access to and removes gestores (MANAGER), and everyone on staff sees the team list.

**Architecture:** A `TeamService` (transactions via `runInTenantContext`, Supabase provisioning via `getAuthAdmin().ensureAuthUser` after commit) behind four API routes (`/api/team`, `/api/team/members`, `/api/team/members/[id]/remind`, `/api/team/members/[id]`); a TanStack Query hook module and a client page reusing the creator access-instructions dialog.

**Tech Stack:** Next.js 16 App Router, React 19, TanStack Query v5, Drizzle + Postgres, zod 4, Supabase Auth admin (via `src/lib/auth/auth-admin.ts`), Vitest + Testing Library, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-11-manager-invite-design.md` (read it first; it is authoritative for behavior).

## Global Constraints

- Every query and join carries an explicit `organization_id` predicate; DB work inside `runInTenantContext`; never `Promise.all` inside one transaction.
- `ensureAuthUser` runs **after** the transaction commits, never inside it. Link only when it returns `created: true` with an id, via the conditional `UsersRepository.linkAuthUser` (never overwrites).
- Only OWNER writes (invite, remind, remove). MANAGER reads. CREATOR: 403 on the API; the page redirects to `/pipeline`; no sidebar item.
- API routes read the session only through `getRouteSession()` (`src/lib/auth/http.ts`); `[id]` routes validate `isUuid` first (404).
- Error bodies `{ error, code? }`; validation 400 `{ errors: z.flattenError(err).fieldErrors }`; never raw exception text; 40P01 → 409 `DEADLOCK_MESSAGE` (`src/lib/db-errors.ts`).
- Portuguese copy verbatim (see spec §2–§4), including:
  - 409 `ALREADY_IN_TEAM` "Essa pessoa já faz parte da equipe."; `IS_CREATOR` "Esse e-mail é de um creator desta organização."; `OTHER_ORGANIZATION` "Esse e-mail já tem acesso a outra organização."; `NOT_A_MANAGER` "Só é possível reenviar o acesso de um gestor."; `CANNOT_REMOVE_OWNER` "Não é possível remover um proprietário."; `CANNOT_REMOVE_SELF` "Você não pode remover o próprio acesso."
  - 404 "Membro não encontrado."; 403 "Sem permissão."; 400 "Informe o nome." / "Informe um e-mail válido."
  - 502 `{ error: "Não foi possível liberar o acesso agora. Tente novamente.", code: "AUTH_PROVISIONING_FAILED" }`
  - Message: "Olá, {fullName}! Você foi convidado(a) para a equipe da {organização} no PublyFlow. Acesse {origin}/login e entre com Google ou com um link enviado para {email}."
  - UI: "Equipe", "Proprietário", "Gestor", "Convidado", "Ativo", "Você", "Convidar gestor", "Nome completo", "E-mail", "Cancelar", "Convidar", "Reenviar acesso", "Remover acesso", "Remover o acesso de {nome}? A pessoa perde o acesso imediatamente.", "Remover", "Acesso removido."
- Lucide icons only, no emoji/symbol glyphs; no content overflowing containers at 320–1920px.
- Tests: `/opt/homebrew/bin/pnpm vitest run --dir src <files> --testTimeout=60000 --hookTimeout=60000`; never two vitest processes at once; `pnpm tsc --noEmit`. Mock `@/lib/auth/auth-admin` wherever `ensureAuthUser` is reached.
- No migration. **Database operations (migrations, SQL against dev/test/prod) are done by the controller only — never by a subagent.**

## File map

| File | Responsibility |
|---|---|
| `src/domain/team/errors.ts` (new) | `TeamConflictError`, `TeamMemberNotFoundError`, `TEAM_ERRORS` |
| `src/lib/team/access-instructions.ts` (new) | `buildTeamAccessInstructions` |
| `src/repositories/team.repository.ts` (new) | list staff, lock membership, upsert/lock user by e-mail, org name |
| `src/services/team.service.ts` (new) | `list`, `inviteManager`, `remind`, `remove` |
| `src/app/api/team/route.ts`, `src/app/api/team/members/route.ts`, `src/app/api/team/members/[id]/route.ts`, `src/app/api/team/members/[id]/remind/route.ts`, `src/app/api/team/team-errors.ts` (new) | HTTP |
| `src/hooks/use-team.ts` (new) | queries/mutations |
| `src/app/(app)/team/page.tsx`, `src/components/team/*` (new), `src/components/shell/sidebar.tsx` | UI |

---

### Task 1: Team domain, repository and invite

**Files:**
- Create: `src/domain/team/errors.ts`, `src/lib/team/access-instructions.ts` (+ `.test.ts`), `src/repositories/team.repository.ts`, `src/services/team.service.ts`, `src/services/team.service.test.ts`

**Interfaces:**
- Consumes: `getAuthAdmin()` / `AuthAdmin.ensureAuthUser(email)` → `{ authUserId: string | null; created: boolean }` (`src/lib/auth/auth-admin.ts`); `AuthProvisioningError` (`src/lib/auth/errors.ts`); `UsersRepository.linkAuthUser(db, userId, authUserId): Promise<boolean>`; `OrganizationMembersRepository.listForUser(tx, userId)`; `CreatorsRepository.findByUserIdWithTx(tx, organizationId, userId)`; `DomainEventsRepository.appendWithTx(tx, organizationId, { eventType, entityType, entityId, payload, actor })`; `runInTenantContext(db, organizationId, fn)`; `Session` (`src/lib/auth/types.ts`).
- Produces:
  - `type TeamConflictCode = "ALREADY_IN_TEAM" | "IS_CREATOR" | "OTHER_ORGANIZATION" | "NOT_A_MANAGER" | "CANNOT_REMOVE_OWNER" | "CANNOT_REMOVE_SELF"`; `class TeamConflictError extends Error { code: TeamConflictCode }`; `class TeamMemberNotFoundError extends Error` (message "Membro não encontrado."); `TEAM_ERRORS: Record<TeamConflictCode, string>`.
  - `buildTeamAccessInstructions({ fullName, organizationName, email, origin }): { loginUrl: string; message: string }`.
  - `interface TeamMember { id: string; fullName: string; email: string; role: "OWNER" | "MANAGER"; status: "invited" | "active"; isSelf: boolean }`.
  - `TeamService.list(db, session): Promise<TeamMember[]>`.
  - `TeamService.inviteManager(db, session, input: { fullName: string; email: string }, origin: string): Promise<{ member: TeamMember; loginUrl: string; message: string }>`.

- [ ] **Step 1: Errors** — `src/domain/team/errors.ts`:

```ts
export type TeamConflictCode =
  | "ALREADY_IN_TEAM"
  | "IS_CREATOR"
  | "OTHER_ORGANIZATION"
  | "NOT_A_MANAGER"
  | "CANNOT_REMOVE_OWNER"
  | "CANNOT_REMOVE_SELF";

export const TEAM_ERRORS: Record<TeamConflictCode, string> = {
  ALREADY_IN_TEAM: "Essa pessoa já faz parte da equipe.",
  IS_CREATOR: "Esse e-mail é de um creator desta organização.",
  OTHER_ORGANIZATION: "Esse e-mail já tem acesso a outra organização.",
  NOT_A_MANAGER: "Só é possível reenviar o acesso de um gestor.",
  CANNOT_REMOVE_OWNER: "Não é possível remover um proprietário.",
  CANNOT_REMOVE_SELF: "Você não pode remover o próprio acesso.",
};

export class TeamConflictError extends Error {
  constructor(public readonly code: TeamConflictCode) {
    super(TEAM_ERRORS[code]);
    this.name = "TeamConflictError";
  }
}

export class TeamMemberNotFoundError extends Error {
  constructor() {
    super("Membro não encontrado.");
    this.name = "TeamMemberNotFoundError";
  }
}
```

- [ ] **Step 2: Message builder + test** — `src/lib/team/access-instructions.ts`:

```ts
export function buildTeamAccessInstructions(input: {
  fullName: string;
  organizationName: string;
  email: string;
  origin: string;
}): { loginUrl: string; message: string } {
  const loginUrl = `${input.origin}/login`;
  return {
    loginUrl,
    message: `Olá, ${input.fullName}! Você foi convidado(a) para a equipe da ${input.organizationName} no PublyFlow. Acesse ${loginUrl} e entre com Google ou com um link enviado para ${input.email}.`,
  };
}
```

Test (`access-instructions.test.ts`): exact message for `{ fullName: "Ana Lima", organizationName: "Agência X", email: "ana@x.test", origin: "https://publyflow.vercel.app" }` and `loginUrl` = `https://publyflow.vercel.app/login`.

- [ ] **Step 3: Repository** — `src/repositories/team.repository.ts`:

```ts
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { organizationMembers, organizations, users } from "@/db/schema/organizations";

type Tx = NodePgDatabase<typeof schema>;

export interface StaffRow {
  membershipId: string;
  userId: string;
  fullName: string;
  email: string;
  role: "OWNER" | "MANAGER";
  firstLoginAt: Date | null;
}

const staffColumns = {
  membershipId: organizationMembers.id,
  userId: users.id,
  fullName: users.fullName,
  email: users.email,
  role: organizationMembers.role,
  firstLoginAt: organizationMembers.firstLoginAt,
};

export const TeamRepository = {
  // OWNER first, then MANAGER; by lower(full_name), lower(email), id.
  async listStaffWithTx(tx: Tx, organizationId: string): Promise<StaffRow[]> {
    const rows = await tx
      .select(staffColumns)
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(and(eq(organizationMembers.organizationId, organizationId), inArray(organizationMembers.role, ["OWNER", "MANAGER"])))
      .orderBy(
        sql`case when ${organizationMembers.role} = 'OWNER' then 0 else 1 end`,
        sql`lower(${users.fullName})`,
        sql`lower(${users.email})`,
        asc(organizationMembers.id),
      );
    return rows as StaffRow[];
  },

  async findStaffByMembershipWithTx(tx: Tx, organizationId: string, membershipId: string, lock: boolean): Promise<StaffRow | null> {
    const query = tx
      .select(staffColumns)
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(
        and(
          eq(organizationMembers.id, membershipId),
          eq(organizationMembers.organizationId, organizationId),
          inArray(organizationMembers.role, ["OWNER", "MANAGER"]),
        ),
      );
    const [row] = lock ? await query.for("update", { of: organizationMembers }) : await query;
    return (row as StaffRow | undefined) ?? null;
  },

  // Create-or-reuse by lower(email), then lock the row: a single row lock,
  // so concurrent invites of the same e-mail serialize here.
  async upsertAndLockUserByEmailWithTx(tx: Tx, email: string, fullName: string) {
    await tx.execute(sql`insert into users (email, full_name) values (${email}, ${fullName}) on conflict (lower(email)) do nothing`);
    const [user] = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .for("update");
    return user;
  },

  async organizationNameWithTx(tx: Tx, organizationId: string): Promise<string> {
    const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId));
    return org.name;
  },
};
```

If Drizzle's `.for("update", { of: organizationMembers })` typing differs in the installed version, use `.for("update")` (the join's other table is `users`, which is never updated here) — `pnpm tsc --noEmit` decides.

- [ ] **Step 4: Failing service tests** — `src/services/team.service.test.ts` (top of file, before importing the service):

```ts
const ensureAuthUser = vi.fn(async (_email: string) => ({ authUserId: "11111111-1111-4111-8111-111111111111", created: true }));
vi.mock("@/lib/auth/auth-admin", () => ({ getAuthAdmin: () => ({ ensureAuthUser, listAuthEmails: vi.fn() }) }));
```

Seed with `withTestDb()` + `OrganizationService.createWithOwner` (OWNER session via `ownerSession(organization.id, owner.id)` from `src/test/helpers/route.ts`). Cases for `inviteManager` (origin `http://localhost:3000`):
1. new e-mail → returns `member` `{ role: "MANAGER", status: "invited", isSelf: false, fullName, email }`, exact message (org name from the DB), one MANAGER membership row, exactly one `domain_events` row with `event_type = 'member.invited'`, `ensureAuthUser` called once with the e-mail, `users.auth_user_id` = the returned id.
2. e-mail with different case than an existing `users` row without membership → row reused (no second `users` row), stored `full_name` kept.
3. `ensureAuthUser` resolves `{ authUserId: null, created: false }` → not linked (`auth_user_id` stays null), still 200 result.
4. existing `auth_user_id` on the user → never overwritten (`linkAuthUser` is conditional; assert value unchanged).
5. already MANAGER here → idempotent: no second membership, **no second `member.invited` event**, `ensureAuthUser` called, result returned.
6. OWNER here → `TeamConflictError` `ALREADY_IN_TEAM`; nothing written; `ensureAuthUser` not called.
7. creator of this org (a `creators` row via `CreatorService.onboardCreator`, never invited) → `IS_CREATOR`; same with a CREATOR membership.
8. membership in another org → `OTHER_ORGANIZATION`; the error carries no other data.
9. `ensureAuthUser` rejects `AuthProvisioningError` → rejects with it; membership committed; a second call with `ensureAuthUser` resolving `{ created: false }` → succeeds, not linked.
10. two concurrent invites (`Promise.all` of two `inviteManager` calls — separate transactions, allowed) with `"Bia@X.test"` and `"bia@x.test"` → both resolve or one rejects with `TeamConflictError`; never another error; exactly one membership and one `member.invited` event.

`list` cases: OWNER first then MANAGER by name; CREATOR memberships excluded; another org's members never appear; `isSelf` true only for `session.userId`; `status` "active" when `first_login_at` is set.

- [ ] **Step 5: Run** → FAIL (module not found).

- [ ] **Step 6: Implement** `src/services/team.service.ts`:

```ts
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { organizationMembers } from "@/db/schema/organizations";
import { runInTenantContext } from "@/repositories/tenant-context";
import { TeamRepository, type StaffRow } from "@/repositories/team.repository";
import { OrganizationMembersRepository } from "@/repositories/organization-members.repository";
import { CreatorsRepository } from "@/repositories/creators.repository";
import { DomainEventsRepository } from "@/repositories/domain-events.repository";
import { UsersRepository } from "@/repositories/users.repository";
import { getAuthAdmin } from "@/lib/auth/auth-admin";
import { buildTeamAccessInstructions } from "@/lib/team/access-instructions";
import { TeamConflictError } from "@/domain/team/errors";
import type { Session } from "@/lib/auth/types";

type Db = NodePgDatabase<typeof schema>;

export interface TeamMember {
  id: string;
  fullName: string;
  email: string;
  role: "OWNER" | "MANAGER";
  status: "invited" | "active";
  isSelf: boolean;
}

function toMember(row: StaffRow, session: Session): TeamMember {
  return {
    id: row.membershipId,
    fullName: row.fullName,
    email: row.email,
    role: row.role,
    status: row.firstLoginAt ? "active" : "invited",
    isSelf: row.userId === session.userId,
  };
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return (e.code ?? e.cause?.code) === "23505";
}

// After commit only. Links solely a Supabase user created right now; an
// existing one is linked on first login by verified e-mail (resolve-session).
async function provisionAuth(db: Db, userId: string, email: string): Promise<void> {
  const ensured = await getAuthAdmin().ensureAuthUser(email);
  if (ensured.created && ensured.authUserId) {
    await UsersRepository.linkAuthUser(db, userId, ensured.authUserId);
  }
}

async function inviteOnce(db: Db, session: Session, input: { fullName: string; email: string }) {
  return runInTenantContext(db, session.organizationId, async (tx) => {
    const user = await TeamRepository.upsertAndLockUserByEmailWithTx(tx, input.email, input.fullName);
    const memberships = await OrganizationMembersRepository.listForUser(tx, user.id);
    const here = memberships.find((m) => m.organizationId === session.organizationId);
    if (memberships.some((m) => m.organizationId !== session.organizationId)) throw new TeamConflictError("OTHER_ORGANIZATION");
    if (here?.role === "OWNER") throw new TeamConflictError("ALREADY_IN_TEAM");
    if (here?.role === "CREATOR" || (await CreatorsRepository.findByUserIdWithTx(tx, session.organizationId, user.id))) {
      throw new TeamConflictError("IS_CREATOR");
    }

    if (!here) {
      const [inserted] = await tx
        .insert(organizationMembers)
        .values({ organizationId: session.organizationId, userId: user.id, role: "MANAGER" })
        .onConflictDoNothing()
        .returning({ id: organizationMembers.id });
      if (inserted) {
        await DomainEventsRepository.appendWithTx(tx, session.organizationId, {
          eventType: "member.invited",
          entityType: "organization_member",
          entityId: inserted.id,
          payload: { membershipId: inserted.id, userId: user.id, invitedBy: session.userId },
          actor: { userId: session.userId },
        });
      }
    }

    const [membership] = await tx
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, session.organizationId), eq(organizationMembers.userId, user.id)));
    const row = await TeamRepository.findStaffByMembershipWithTx(tx, session.organizationId, membership.id, false);
    const organizationName = await TeamRepository.organizationNameWithTx(tx, session.organizationId);
    return { row: row!, userId: user.id, organizationName };
  });
}

export const TeamService = {
  async list(db: Db, session: Session): Promise<TeamMember[]> {
    return runInTenantContext(db, session.organizationId, async (tx) =>
      (await TeamRepository.listStaffWithTx(tx, session.organizationId)).map((row) => toMember(row, session)),
    );
  },

  async inviteManager(db: Db, session: Session, input: { fullName: string; email: string }, origin: string) {
    const email = input.email.trim();
    const fullName = input.fullName.trim();
    let result: Awaited<ReturnType<typeof inviteOnce>>;
    try {
      result = await inviteOnce(db, session, { fullName, email });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // The failed transaction was rolled back; start a fresh one that
      // re-reads the winner's rows and re-applies every rule.
      try {
        result = await inviteOnce(db, session, { fullName, email });
      } catch (retryError) {
        if (isUniqueViolation(retryError)) throw new TeamConflictError("ALREADY_IN_TEAM");
        throw retryError;
      }
    }
    await provisionAuth(db, result.userId, result.row.email);
    const instructions = buildTeamAccessInstructions({
      fullName: result.row.fullName,
      organizationName: result.organizationName,
      email: result.row.email,
      origin,
    });
    return { member: toMember(result.row, session), ...instructions };
  },
};
```

`provisionAuth` and `toMember` are reused by Task 2 — keep them module-level.

- [ ] **Step 7: Run** the service + builder tests → PASS; `pnpm tsc --noEmit` clean.

- [ ] **Step 8: Commit**

```bash
git add src/domain/team src/lib/team src/repositories/team.repository.ts src/services/team.service.ts src/services/team.service.test.ts
git commit -m "feat(team): list staff and invite a manager (idempotent, provisioned after commit)"
```

---

### Task 2: Resend and remove access

**Files:**
- Modify: `src/services/team.service.ts`, `src/services/team.service.test.ts`

**Interfaces:**
- Consumes: Task 1 (`TeamRepository.findStaffByMembershipWithTx`, `TeamRepository.organizationNameWithTx`, `provisionAuth`, `toMember`, errors).
- Produces:
  - `TeamService.remind(db, session, membershipId: string, origin: string): Promise<{ loginUrl: string; message: string }>`
  - `TeamService.remove(db, session, membershipId: string): Promise<void>`

- [ ] **Step 1: Failing tests** (same file, same mock):
  - remind: MANAGER of this org → `ensureAuthUser` called with its e-mail, exact message; linked only when `created`; OWNER target → `TeamConflictError` `NOT_A_MANAGER`; unknown id / another org's membership / a CREATOR membership → `TeamMemberNotFoundError`; `ensureAuthUser` failure → `AuthProvisioningError`.
  - remove: MANAGER → membership deleted, `users` row kept, existing `notifications` rows of that user kept, one `member.removed` event; OWNER target → `CANNOT_REMOVE_OWNER`; self-removal: call `remove` with a session whose `userId` is the target MANAGER's user id (role "OWNER" in the session object; the route never allows this combination, the service rule is unit-tested directly) → `CANNOT_REMOVE_SELF`; unknown / other org → `TeamMemberNotFoundError`.
  - effective revocation: after `remove`, `resolveSessionForAuthUser(db, { id: <that user's auth id>, email, emailVerified: true })` returns null (link an auth id to the manager before removing).
  - fan-out after removal: `NotificationsRepository.fanOutWithTx` for a `staff` audience does not include the removed user (read its exact name/signature in `src/repositories/notifications.repository.ts`).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** in `TeamService`:

```ts
  async remind(db: Db, session: Session, membershipId: string, origin: string) {
    const { row, organizationName } = await runInTenantContext(db, session.organizationId, async (tx) => {
      const found = await TeamRepository.findStaffByMembershipWithTx(tx, session.organizationId, membershipId, false);
      if (!found) throw new TeamMemberNotFoundError();
      if (found.role !== "MANAGER") throw new TeamConflictError("NOT_A_MANAGER");
      return { row: found, organizationName: await TeamRepository.organizationNameWithTx(tx, session.organizationId) };
    });
    await provisionAuth(db, row.userId, row.email);
    return buildTeamAccessInstructions({ fullName: row.fullName, organizationName, email: row.email, origin });
  },

  async remove(db: Db, session: Session, membershipId: string): Promise<void> {
    await runInTenantContext(db, session.organizationId, async (tx) => {
      const row = await TeamRepository.findStaffByMembershipWithTx(tx, session.organizationId, membershipId, true);
      if (!row) throw new TeamMemberNotFoundError();
      if (row.role === "OWNER") throw new TeamConflictError("CANNOT_REMOVE_OWNER");
      if (row.userId === session.userId) throw new TeamConflictError("CANNOT_REMOVE_SELF");
      await tx
        .delete(organizationMembers)
        .where(and(eq(organizationMembers.id, membershipId), eq(organizationMembers.organizationId, session.organizationId)));
      await DomainEventsRepository.appendWithTx(tx, session.organizationId, {
        eventType: "member.removed",
        entityType: "organization_member",
        entityId: membershipId,
        payload: { membershipId, userId: row.userId, removedBy: session.userId },
        actor: { userId: session.userId },
      });
    });
  },
```

(import `TeamMemberNotFoundError`).

- [ ] **Step 4: Run** → PASS; `pnpm tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/services/team.service.ts src/services/team.service.test.ts
git commit -m "feat(team): resend and remove manager access"
```

---

### Task 3: API routes

**Files:**
- Create: `src/app/api/team/team-errors.ts`, `src/app/api/team/route.ts` (+ test), `src/app/api/team/members/route.ts` (+ test), `src/app/api/team/members/[id]/route.ts` (+ test), `src/app/api/team/members/[id]/remind/route.ts` (+ test)
- Check (no edit expected): `src/app/api/write-guard.test.ts`, `src/app/api/id-guard.test.ts`, `src/app/api/route-session-guard.test.ts` pick up the new routes; extend `id-guard` if it lists routes explicitly.

**Interfaces:**
- Consumes: `TeamService.*`, errors (Tasks 1–2); `getRouteSession`, `forbiddenResponse`, `authProvisioningFailedResponse` (`src/lib/auth/http.ts`); `isUuid` (`src/lib/uuid.ts`); `isDeadlockError`, `DEADLOCK_MESSAGE` (`src/lib/db-errors.ts`); `AuthProvisioningError`.
- Produces: `teamErrorResponse(error: unknown): NextResponse | null` in `team-errors.ts`; zod schema `inviteManagerSchema` exported from `src/app/api/team/members/route.ts`'s sibling `src/lib/team/team-input.ts`:

```ts
import { z } from "zod";
export const inviteManagerSchema = z.object({
  fullName: z.string().trim().min(1, "Informe o nome.").max(200, "Informe o nome."),
  email: z.email({ error: "Informe um e-mail válido." }).max(254, "Informe um e-mail válido."),
});
```

- [ ] **Step 1: Error mapper**:

```ts
import { NextResponse } from "next/server";
import { TeamConflictError, TeamMemberNotFoundError } from "@/domain/team/errors";
import { AuthProvisioningError } from "@/lib/auth/errors";
import { authProvisioningFailedResponse } from "@/lib/auth/http";
import { DEADLOCK_MESSAGE, isDeadlockError } from "@/lib/db-errors";

export function teamNotFoundResponse(): NextResponse {
  return NextResponse.json({ error: "Membro não encontrado." }, { status: 404 });
}

export function teamErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof TeamMemberNotFoundError) return teamNotFoundResponse();
  if (error instanceof TeamConflictError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
  if (error instanceof AuthProvisioningError) return authProvisioningFailedResponse();
  if (isDeadlockError(error)) return NextResponse.json({ error: DEADLOCK_MESSAGE }, { status: 409 });
  return null;
}
```

- [ ] **Step 2: Routes** (pattern for every handler; OWNER check via `canManageTeam(session.role)` (defined below) → `forbiddenResponse()`):

```ts
// src/app/api/team/route.ts
export async function GET() {
  const session = await getRouteSession();
  if (session instanceof NextResponse) return session;
  if (session.role === "CREATOR") return forbiddenResponse();
  return NextResponse.json(await TeamService.list(db, session), { status: 200 });
}

// src/app/api/team/members/route.ts
export async function POST(request: Request) {
  const session = await getRouteSession();
  if (session instanceof NextResponse) return session;
  if (!canManageTeam(session.role)) return forbiddenResponse();
  const parsed = inviteManagerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ errors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  try {
    const result = await TeamService.inviteManager(db, session, parsed.data, new URL(request.url).origin);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const mapped = teamErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}

// src/app/api/team/members/[id]/route.ts
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getRouteSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  if (!isUuid(id)) return teamNotFoundResponse();
  if (!canManageTeam(session.role)) return forbiddenResponse();
  try {
    await TeamService.remove(db, session, id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const mapped = teamErrorResponse(error);
    if (mapped) return mapped;
    throw error;
  }
}

// src/app/api/team/members/[id]/remind/route.ts — POST, same guards as DELETE, no body read;
// returns 200 TeamService.remind(db, session, id, new URL(request.url).origin).
```

The write guard (`write-guard.test.ts`) requires `denyCreatorWrite(` or `canManageOrganization(` in write routes. Satisfy it without weakening the OWNER rule by adding to `src/lib/auth/access.ts`:

```ts
/** Team management is OWNER-only (spec 2026-10-11 D2). */
export function canManageTeam(role: SessionRole): boolean {
  return role === "OWNER";
}
```

use `if (!canManageTeam(session.role)) return forbiddenResponse();` in the three write routes, and add `canManageTeam\(` to `GUARD_RE` in `src/app/api/write-guard.test.ts` (`/denyCreatorWrite\(|canManageOrganization\(|canManageTeam\(/`). Unit-test `canManageTeam` in `src/lib/auth/access.test.ts`.

- [ ] **Step 3: Route tests** with `importRouteWithSession` (+ `extraMocks` for `@/lib/auth/auth-admin`; resolve error classes via dynamic import after `vi.resetModules()` so `instanceof` matches). Per route: 401 (session null); CREATOR 403 (GET too); MANAGER 403 on writes, 200 on GET; malformed id → 404 "Membro não encontrado."; 400 with field errors (empty name, bad e-mail); 409 bodies with `code` for each conflict; 502 body; success shapes — `POST` returns `member` deep-equal to the matching item of a subsequent `GET`; `DELETE` 204 then `GET` without that member; other-org membership id → 404; `OTHER_ORGANIZATION` response body has only `{ error, code }`.

- [ ] **Step 4: Run** the new route tests + the three guard tests + `access.test.ts`; `pnpm tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/team src/lib/team/team-input.ts src/lib/auth/access.ts src/lib/auth/access.test.ts src/app/api/write-guard.test.ts src/app/api/id-guard.test.ts
git commit -m "feat(api): team list, invite, resend and remove routes (OWNER-only writes)"
```

---

### Task 4: Equipe page, hooks and sidebar

**Files:**
- Create: `src/hooks/use-team.ts` (+ test), `src/app/(app)/team/page.tsx` (+ test), `src/components/team/invite-manager-dialog.tsx` (+ test), `src/components/team/team-member-actions.tsx` (+ test)
- Modify: `src/components/shell/sidebar.tsx` (+ its test if present)

**Interfaces:**
- Consumes: API from Task 3; `AccessInstructionsDialog({ open, onOpenChange, email, message })` (`src/components/creators/access-instructions-dialog.tsx`); `useSessionRole()` / `useIsCreator()` (`src/components/shell/session-role-context.tsx`); `apiFetch`, `ApiError` (`src/lib/api-client.ts`).
- Produces: `TeamMemberDto` (same fields as `TeamMember`), `teamQueryKey = ["team"]`, `useTeam()`, `useInviteManager()`, `useRemindManager()`, `useRemoveManager()`.

- [ ] **Step 1: Hooks** — `src/hooks/use-team.ts`, modeled on `src/hooks/use-creators.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export interface TeamMemberDto {
  id: string;
  fullName: string;
  email: string;
  role: "OWNER" | "MANAGER";
  status: "invited" | "active";
  isSelf: boolean;
}
export interface TeamAccessInstructionsDto {
  loginUrl: string;
  message: string;
}

export const teamQueryKey = ["team"] as const;

export function useTeam() {
  return useQuery({ queryKey: teamQueryKey, queryFn: () => apiFetch<TeamMemberDto[]>("/api/team") });
}

export function useInviteManager() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: { fullName: string; email: string }) =>
      apiFetch<{ member: TeamMemberDto } & TeamAccessInstructionsDto>("/api/team/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: teamQueryKey }),
  });
}

export function useRemindManager() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId }: { memberId: string }) =>
      apiFetch<TeamAccessInstructionsDto>(`/api/team/members/${memberId}/remind`, { method: "POST" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: teamQueryKey }),
  });
}

export function useRemoveManager() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId }: { memberId: string }) =>
      apiFetch<void>(`/api/team/members/${memberId}`, { method: "DELETE" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: teamQueryKey }),
  });
}
```

Check how `apiFetch` handles 204 in `src/lib/api-client.ts` and follow what `useRevokeCreatorAccess` does. Hook tests modeled on `src/hooks/use-creators.test.tsx`.

- [ ] **Step 2: Invite dialog** — `InviteManagerDialog({ open, onOpenChange, onInvited })` where `onInvited({ email, message })`: fields "Nome completo" and "E-mail" (labels bound to inputs), "Cancelar" / "Convidar" (disabled while pending). On 400 show `errors.fullName?.[0]` / `errors.email?.[0]` under each input (`aria-describedby`, `role="alert"`); on 409/502 show `ApiError.message` at the top (`role="alert"`); on success: reset, `onOpenChange(false)`, `onInvited({ email: result.member.email, message: result.message })`. Read how `src/components/creators/creator-form-dialog.tsx` surfaces 400 `errors` from `ApiError` and do the same.

- [ ] **Step 3: Row actions** — `TeamMemberActions({ member, onInstructions })` modeled on `src/components/creators/creator-access-actions.tsx`: a `DropdownMenu` (check `src/components/ui/dropdown-menu.tsx` exists; if not, use two ghost buttons instead and say so in the report) with trigger `Button variant="ghost" size="icon"` + lucide `MoreHorizontal`, `aria-label={\`Ações de ${member.fullName}\`}`; items "Reenviar acesso" (→ `onInstructions({ email, message })`; error → toast with `ApiError.message`) and "Remover acesso" → `AlertDialog` "Remover o acesso de {nome}? A pessoa perde o acesso imediatamente." with "Cancelar" / "Remover" (destructive) → toast "Acesso removido.".

- [ ] **Step 4: Page** — `src/app/(app)/team/page.tsx` (`"use client"`):
  - `useSessionRole()`; CREATOR → `router.replace("/pipeline")` and render null (same as `src/app/(app)/companies/page.tsx:27-30`).
  - Header: `<h1>` "Equipe"; when OWNER, button "Convidar gestor" with lucide `UserPlus`.
  - Loading text, error state with "Tentar novamente" (`refetch`), list.
  - `md` and up: table with columns Nome, E-mail, Papel, Situação and (OWNER only) an actions column; below `md`: cards (`md:hidden` / `hidden md:table` pattern used in other CRM pages — check `src/app/(app)/companies/page.tsx`). Name cell: full name + "Você" badge when `isSelf`. Role labels: OWNER → "Proprietário", MANAGER → "Gestor". Status badge: "Convidado" / "Ativo". Long text: `min-w-0` + `[overflow-wrap:anywhere]`.
  - Actions only for OWNER and only on `role === "MANAGER"` rows.
  - One `AccessInstructionsDialog` driven by `{ email, message } | null` state, opened by invite success and by "Reenviar acesso".

- [ ] **Step 5: Sidebar** — in `src/components/shell/sidebar.tsx` add `{ label: "Equipe", href: "/team", icon: UsersRound }` (import `UsersRound` from lucide-react) after "Dashboard". `CREATOR_ALLOWED_HREFS` already hides it for CREATOR. Update the sidebar test if it asserts the item list.

- [ ] **Step 6: Tests** — page: OWNER sees "Convidar gestor" and the actions menu only on MANAGER rows; MANAGER sees the list without button/menu; "Você" on the self row; role and status labels; CREATOR redirects; error state retry; invite dialog: validation messages, 409 message inside the dialog, success closes it and opens "Instruções de acesso" with the message; remove: confirmation text, toast "Acesso removido."; no emoji/symbol glyphs in rendered text.

- [ ] **Step 7: Verify** — touched tests + `src/components/shell` tests; `pnpm tsc --noEmit`.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/use-team.ts src/hooks/use-team.test.tsx "src/app/(app)/team" src/components/team src/components/shell/sidebar.tsx
git commit -m "feat(team): Equipe page with invite, resend and remove for the owner"
```

---

### Task 5: Verification (controller)

- [ ] `pnpm tsc --noEmit`; `pnpm lint` (no new errors in touched files); full suite `pnpm vitest run --dir src --testTimeout=60000 --hookTimeout=60000`; build (command in CLAUDE.md).
- [ ] Browser (dev, user logs in as OWNER): `/team` lists the OWNER with "Você"; invite a gestor with an e-mail the user controls → instructions dialog; the gestor logs in (Google or link) → enters as MANAGER and sees `/team` read-only; OWNER removes → the gestor's next navigation goes to `/sem-acesso`; layout 320–1920px (DOM overflow audit, not only screenshots).
- [ ] Final whole-branch review; merge + push (no migration); confirm `/team` in production.
