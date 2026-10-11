# Team page and manager invite (TAREFA item E)

Date: 2026-10-11. Status: approved design (user, 2026-10-11), pending written-spec review.
Origin: Auth v1 subproject 2 leftovers. Today a MANAGER can only be created with `pnpm provision-user`; there is no team screen. Public sign-up is off since the auth hardening (2026-10-11), so every flow that creates a user must call `ensureAuthUser` (`src/lib/auth/auth-admin.ts`).

## 1. Decisions

| # | Decision |
|---|---|
| D1 | Scope: a **Equipe** page (`/team`) listing the organization's OWNER and MANAGER members, plus invite manager, resend access and remove access. Creators stay on `/creators`. No role changes in this version. |
| D2 | Only the **OWNER** invites, resends and removes. MANAGER sees the list read-only. CREATOR gets 403 on the API and no sidebar item. First OWNER-only permission in the product. |
| D3 | No e-mail is sent: like the creator invite (spec C), the server returns a ready-to-copy message; the UI reuses the creator access-instructions dialog. |
| D4 | No migration. Existing constraints are enough: `users_email_lower_unique` (0025) and `organization_members_org_user_unique (organization_id, user_id)`. |
| D5 | UI copy in Portuguese: page/sidebar "Equipe"; roles "Proprietário" (OWNER) and "Gestor" (MANAGER); status "Convidado" / "Ativo". Technical names (`/team`, `/api/team`) stay out of the visible text. |

## 2. Rules

### 2.1 Invite (OWNER) — `TeamService.inviteManager(db, session, { fullName, email })`
One transaction (`runInTenantContext`):
1. Normalize the e-mail (`trim`, compare with `lower`). Create-or-reuse the `users` row: `INSERT … ON CONFLICT (lower(email)) DO NOTHING`, then `SELECT … FOR UPDATE` by `lower(email)` — a single row lock, so lock order is deterministic. A reused row keeps its stored `full_name`.
2. Read the user's memberships (`OrganizationMembersRepository.listForUser`) and decide, **in this order**:
   - MANAGER in this organization → **idempotent**: no new membership; continue to step 4 (this is how a retry after a 502 completes provisioning, even for a legacy multi-organization user).
   - OWNER in this organization → 409 `ALREADY_IN_TEAM` "Essa pessoa já faz parte da equipe."
   - CREATOR membership in this organization, **or** a `creators` row of this organization pointing to this user (invited or not) → 409 `IS_CREATOR` "Esse e-mail é de um creator desta organização."
   - any membership in another organization, **or a `creators` row of another organization pointing to this user** (decided 2026-10-11 after the final review: same tie `isEmailEditable` already treats as cross-organization; otherwise org A would see org B's stored name and lock B's creator e-mail) → 409 `OTHER_ORGANIZATION` "Esse e-mail já tem acesso a outra organização." — no ids, names or other data of that user/organization in the response.
3. Insert the MANAGER membership (`ON CONFLICT DO NOTHING` on `(organization_id, user_id)`). Append domain event `member.invited` `{ membershipId, userId, invitedBy: session.userId }` **only when the insert returned a row** — the idempotent path and a conflicting insert append nothing (no handler; the drain marks it done).
4. After commit (never inside the transaction): `getAuthAdmin().ensureAuthUser(email)`. When it returns `created` with an id, link with the conditional `UsersRepository.linkAuthUser(db, userId, authUserId)` (only when `auth_user_id IS NULL`; never overwrites). When the Supabase user already existed, nothing is linked — the first login links by **verified** e-mail (`resolve-session`, unchanged). Failure → `AuthProvisioningError` → 502 `AUTH_PROVISIONING_FAILED`; the membership stays; inviting again or "Reenviar acesso" completes it. The retry never depends on Supabase answering `created: true` again: if the first attempt created the Supabase user but the response was lost, the retry gets "already exists" → `{ created: false }` → 200 without linking, and the first login links by verified e-mail.
5. Return `{ member, loginUrl, message }` where `member` has exactly the `GET /api/team` item shape.

A 23505 that still escapes (race on the unique indexes) makes the service re-run the whole invite once in a **new** `runInTenantContext` (the failed transaction is rolled back and never reused; the new one re-reads and re-applies every rule above, so the winner's rows lead to the idempotent or conflict path); a second 23505 → 409 `ALREADY_IN_TEAM`; 40P01 → 409 `DEADLOCK_MESSAGE` (`src/lib/db-errors.ts`).

### 2.2 Message
Built only from server data — the session's organization name and the stored `full_name` / `email`:
"Olá, {fullName}! Você foi convidado(a) para a equipe da {organização} no PublyFlow. Acesse {origin}/login e entre com Google ou com um link enviado para {email}."
New builder next to `buildAccessInstructions` (`src/lib/team/access-instructions.ts`), same `{ loginUrl, message }` shape.

### 2.3 Resend access (OWNER) — no request body
Membership must exist in this organization and be MANAGER (OWNER target → 409 `NOT_A_MANAGER` "Só é possível reenviar o acesso de um gestor."; other org / unknown → 404). Calls `ensureAuthUser` again (idempotent) + conditional link when created; returns `{ loginUrl, message }`.

### 2.4 Remove access (OWNER)
In one transaction, lock the membership row, then the member's `users` row (same order invite uses: invite locks only the `users` row, so no cycle) — this serializes remove with a concurrent re-invite of the same person; the membership must belong to this organization (else 404).
- target is OWNER → 409 `CANNOT_REMOVE_OWNER` "Não é possível remover um proprietário." (also protects the last OWNER);
- target is the caller → 409 `CANNOT_REMOVE_SELF` "Você não pode remover o próprio acesso.";
- otherwise delete the MANAGER membership; append `member.removed` `{ membershipId, userId, removedBy }`.
`users`, the Supabase user, authorship and notifications are kept. Notification fan-out (`NotificationsRepository`, recipients from current memberships) stops reaching the removed person; their existing notifications stay but are only readable with a session they no longer have. If the same person is invited again later, they see those old notifications again (accepted). Session resolution already re-reads the membership on every request (`getAuthState` → `resolveSessionForAuthUser`), so the removed person gets `/sem-acesso` on the next page and 401 on the next API call, with no sign-out needed.

### 2.5 Status
`status = first_login_at IS NULL ? "invited" : "active"` (UI "Convidado" / "Ativo").

## 3. API

All routes: `getRouteSession()` (401/503) → `isUuid(id)` (404, `[id]` routes) → role check → zod (400 `{ errors }`). `[id]` is the membership id. Errors mapped in a new `src/app/api/team/team-errors.ts`. New routes go in `write-guard` / `id-guard` coverage.

| Route | Who | Success |
|---|---|---|
| `GET /api/team` | OWNER, MANAGER (CREATOR → 403) | `200 TeamMember[]` |
| `POST /api/team/members` `{ fullName, email }` | OWNER (MANAGER → 403) | `200 { member: TeamMember, loginUrl, message }` |
| `POST /api/team/members/[id]/remind` | OWNER | `200 { loginUrl, message }` |
| `DELETE /api/team/members/[id]` | OWNER | `204` |

`TeamMember = { id: string /* membership id */; fullName: string; email: string; role: "OWNER" | "MANAGER"; status: "invited" | "active"; isSelf: boolean }`.
- Only members of the session's organization; CREATOR memberships are excluded.
- Order: OWNER first, then MANAGER; within a role by `lower(full_name)`, then `lower(email)`, then id (deterministic).
- `isSelf` computed from `session.userId`, never from the client.

| Error | HTTP | Body |
|---|---|---|
| validation | 400 | `{ errors }` — messages "Informe o nome." / "Informe um e-mail válido." |
| MANAGER/CREATOR on a write route; CREATOR on GET | 403 | `{ error: "Sem permissão." }` |
| unknown / other org membership | 404 | `{ error: "Membro não encontrado." }` |
| conflicts (§2) | 409 | `{ error, code }` with the codes and messages above |
| deadlock | 409 | `DEADLOCK_MESSAGE` |
| Supabase provisioning | 502 | `{ error: "Não foi possível liberar o acesso agora. Tente novamente.", code: "AUTH_PROVISIONING_FAILED" }` |

## 4. UI

Lucide icons only, no emoji/symbol glyphs; Portuguese copy; no content overflowing containers at 320–1920px.

- **Sidebar:** item "Equipe" (icon `UsersRound`) for OWNER and MANAGER; hidden for CREATOR. `/team` for a CREATOR → same 403 handling as other org-management pages.
- **Page `/team`** (title "Equipe"): table ≥ `md` (Nome, E-mail, Papel, Situação, ações), cards below `md`; long names/e-mails wrap (`overflow-wrap:anywhere`). Role labels "Proprietário" / "Gestor"; status badge "Convidado" / "Ativo"; "Você" next to the caller's name. Loading, empty-of-managers and error (with "Tentar novamente") states.
- **OWNER only:**
  - button "Convidar gestor" (icon `UserPlus`) → dialog with "Nome completo" and "E-mail", "Cancelar" / "Convidar"; field errors under the inputs; 409/502 at the top of the dialog. On success: close it, refresh the list, open the creator access-instructions dialog (reused) with the returned message.
  - on MANAGER rows: actions menu (icon `MoreHorizontal`, aria-label "Ações de {nome}") with "Reenviar acesso" (opens the instructions dialog) and "Remover acesso" → confirmation "Remover o acesso de {nome}? A pessoa perde o acesso imediatamente." "Cancelar" / "Remover" (destructive) → toast "Acesso removido."; refresh the list.
- **MANAGER:** same list, no button, no actions column.

## 5. Tests

Vitest against the real test Postgres; `@/lib/auth/auth-admin` mocked wherever `ensureAuthUser` is reached.
- **Service:** new user → users + MANAGER membership + event + `ensureAuthUser` + linked when created; existing users row without membership → reused, `full_name` kept; Supabase user already existed → not linked; already MANAGER → idempotent (no second membership, `ensureAuthUser` called, 200); OWNER/creator (membership or creators row)/other org → the right 409, no write; `ensureAuthUser` failure → membership kept, retry succeeds; two concurrent invites of the same e-mail (case-different) → one membership and exactly one `member.invited` event, both calls succeed or one 409, never a 500; retry after a 502 where Supabase now answers "already exists" → 200, not linked; never overwrites an existing `auth_user_id`.
- **Remind / remove:** OWNER/self/other-org/unknown cases; removal keeps `users` and existing notifications; a later fan-out does not include the removed person; after removal `getAuthState` → no-access (page → `/sem-acesso`) and `getRouteSession` → 401.
- **List:** org isolation (members of another org never appear), CREATOR excluded, order, `isSelf`.
- **Routes:** 401, 403 (MANAGER writes, CREATOR all), 404 (incl. malformed id), 400, 409 bodies, 502 body, success shapes (`member` equals the list item shape); conflict for another org leaks no data; guard tests pass.
- **UI:** OWNER sees button and menu; MANAGER read-only; invite dialog (validation, 409/502 inside, success opens instructions dialog); remove confirmation + toast; responsive cards; no glyphs.
- **Manual (browser):** invite a gestor with a Gmail you control → Google login enters as MANAGER; remove → next navigation `/sem-acesso`; layout 320–1920px.

## 6. Deploy
No migration, but it depends on 0025 (`users_email_lower_unique`, used by `on conflict (lower(email))`): confirm it is applied in production (it is since 2026-10-11, 26 migrations) before pushing. Push `main`; verify `/team` in production (OWNER sees actions, a MANAGER does not). Optional: `pnpm exec tsx scripts/backfill-auth-users.ts --check` stays at blocking 0.

## 7. Out of scope
Changing roles (promote/demote), inviting another OWNER, transferring ownership, e-mail delivery, multi-organization users, removing creators from this page.
