# Auth hardening (TAREFA item 3)

Date: 2026-10-06. Status: approved design (user, 2026-10-06), pending written-spec review.
Origin: parked follow-ups from the Auth v1 final review (`docs/superpowers/specs/2026-09-24-auth-v1-design.md`). Six independent fixes shipped together. One migration (0025: index only).

Out of scope (separate specs, in this order): E — manager invite; F — password reset; G — RLS enforced at runtime. Self-service signup that creates an organization is not prioritized.

## 1. The server creates Supabase users; public sign-up is turned off

**Problem:** provisioning creates a Supabase auth user only with `--password`; everyone else (and every invited creator) gets one from Supabase itself on first login (`signInWithOtp({ shouldCreateUser: true })` or first Google login). So "Allow new users to sign up" must stay on, and anyone can create a Supabase account.

**Change:**
- New `src/lib/auth/auth-admin.ts`: admin client built from `SUPABASE_SERVICE_ROLE_KEY` (server-only env var, never `NEXT_PUBLIC_*`; added to Vercel) and `ensureAuthUser(email, { password? }): Promise<{ authUserId: string | null; created: boolean }>`:
  - calls `admin.createUser({ email, email_confirm: true, password? })` (password only from the provisioning script; an existing user's password is never changed);
  - created → `{ authUserId: <id>, created: true }`;
  - e-mail already registered in Supabase → `{ authUserId: null, created: false }` (success, idempotent);
  - any other failure (network, 5xx, misconfiguration) → throws `AuthProvisioningError`.
- When `created`, the caller links immediately with the existing conditional `UsersRepository.linkAuthUser(db, userId, authUserId)`. When the e-mail already existed, linking stays with the first login (`resolve-session` links by verified e-mail, unchanged) — known gap, tracked in TAREFA as tech debt: "Investigar lookup administrativo por e-mail no Supabase para vincular `auth_user_id` imediatamente quando o usuário já existir em `auth.users`."
- Called **after** the database transaction commits, never inside it, at:
  - provisioning (`src/lib/auth/provision-user.ts`, always; `--password` stays optional and is passed through);
  - creator invite and remind (`CreatorAccessService.invite` / `remind`);
  - creator e-mail change (`CreatorService.changeEmail`, for the new e-mail).
- Failure: the route returns **502** `{ error: "Não foi possível liberar o acesso agora. Tente novamente.", code: "AUTH_PROVISIONING_FAILED" }`. The database write already committed. This state ("invite created, auth user not provisioned") is **recoverable**: repeating the invite, sending the reminder or correcting the e-mail all call `ensureAuthUser` again. No state gets stuck.
- Magic link (`src/app/(auth)/login/actions.ts`): `shouldCreateUser: false`. The answer stays identical for any e-mail (never reveals who has access).
- Backfill script `pnpm backfill-auth-users` (`scripts/backfill-auth-users.ts`): for each `users` row without `auth_user_id` that has a membership, `ensureAuthUser` + link when created. `--check` mode is read-only and prints two counts: (a) `users` without `auth_user_id`; (b) member e-mails that do not exist in `auth.users`. Both must be 0 before sign-up is turned off.
- The creator invite instructions text is unchanged (Google or e-mail link still work for a provisioned e-mail).

## 2. Logout is POST-only

- `POST /auth/signout` signs out and redirects to `/login` (303) — the only way to log out. The header already uses a POST form.
- `GET /auth/signout` → **405** with `Allow: POST`; never changes state. The `?reason=no-access` parameter is removed.
- "No access" flow: `requireAppSession()` redirects to `/sem-acesso` without signing out (`src/lib/auth/require-app-session.ts`). `/sem-acesso` replaces the "Voltar ao login" link with a POST form button "Sair e entrar com outra conta". The OAuth callback and the password action already redirect to `/sem-acesso`; they keep doing so.

## 3. `/login` with an active session

- `/login` (server component) calls `getSession()`:
  - session with access → `redirect("/pipeline")`;
  - Supabase user without PublyFlow access → stays on `/login`, but above the form shows the no-access notice: "Você está conectado como {email}, mas essa conta não tem acesso ao PublyFlow." plus the POST button "Sair e entrar com outra conta" — never a login screen that looks normal to someone already authenticated;
  - no Supabase user → login form as today.
- Auth unavailable (§6) → the same error page as the app (no redirect).

## 4. Case-insensitive unique e-mail

- Migration 0025 (drizzle-kit): unique index `users_email_lower_unique` on `users (lower(email))`, declared in the Drizzle schema.
- 23505 on this index during invite/e-mail change → existing **409** "Já existe um creator com este e-mail."; in the provisioning script → clear error message.
- Deploy: run read-only before applying in production and record the result:
  `select lower(email), count(*) from users group by lower(email) having count(*) > 1;` (0 rows on 2026-10-06).

## 5. One Supabase user lookup per request

- `getSession()` is wrapped in React `cache()` so the layout and the page (and any nested server component) share one resolution per render.
- `src/proxy.ts` uses `supabase.auth.getClaims()` instead of `getUser()` to decide the `/login` redirect and refresh cookies. It verifies the JWT locally when the Supabase project uses asymmetric signing keys and falls back to a network call otherwise (same cost as today).
- `getClaims()` is a proxy optimization only and must not change authentication semantics: authorization still comes from `getSession()` (`getUser()` + PublyFlow membership). No code may read JWT claims for access decisions.
- Deploy: check in the Supabase dashboard whether dev/prod use asymmetric signing keys; migrating is the user's decision, the code works either way.

## 6. Supabase outage is not "no access"

- New `AuthUnavailableError` (`src/lib/auth/errors.ts`) for network failures and 5xx from Supabase (including `AuthRetryableFetchError`). "No session" is still `null`, never this error.
- `getSession()` throws `AuthUnavailableError` when `getUser()` fails that way.
- **Proxy:** on such a failure it lets the request through (no redirect to `/login`).
- **Pages:** `requireAppSession()` lets the error propagate; an error boundary for the authenticated app (and `/login`) shows "Não foi possível verificar sua sessão agora. Tente novamente em instantes." with a "Tentar novamente" button (lucide `RefreshCw`). The UI copy never mentions Supabase or authentication services. Never signs out, never goes to `/sem-acesso`.
- **API:** new `getRouteSession()` in `src/lib/auth/http.ts` returns `Session` or a `NextResponse`: 401 `unauthorizedResponse()` when there is no session, **503** `{ error: "Serviço de autenticação indisponível. Tente novamente em instantes.", code: "AUTH_UNAVAILABLE" }` on `AuthUnavailableError`. All 49 API routes that call `getSession()` switch to it (mechanical change); a guard test (pattern of `src/app/api/write-guard.test.ts`) fails if a route under `src/app/api` calls `getSession()` directly.

## Constraints

Org predicate on every query; no `Promise.all` inside one transaction; external calls (Supabase admin) never inside a DB transaction; Portuguese messages verbatim; no emoji/symbol glyphs in UI (lucide icons only); no content overflowing containers (320–1920px); service-role key server-only.

## Tests

- `ensureAuthUser`: created / already exists / failure → `AuthProvisioningError` (admin client mocked); links when created.
- Provisioning, invite, remind, e-mail change: call `ensureAuthUser` after commit; failure → 502 with the DB write kept; retry succeeds.
- Magic link uses `shouldCreateUser: false`.
- Backfill: creates/links missing users; `--check` writes nothing and reports both counts.
- Signout: POST signs out; GET → 405 and does not sign out.
- `requireAppSession` without access → `/sem-acesso`, no sign-out; `/sem-acesso` and `/login` (no-access state) render the POST button.
- `/login`: with access → redirect `/pipeline`; no-access notice; no user → form.
- 0025: second user with the same e-mail in different case fails at the DB; invite/e-mail change → 409.
- `getSession` cached per render (one `getUser` call for layout + page).
- Outage: mocked network error → route 503 `AUTH_UNAVAILABLE`; page error boundary; proxy does not redirect; guard test for `getRouteSession`.

## Deploy (in order)

1. Add `SUPABASE_SERVICE_ROLE_KEY` to Vercel (production).
2. Read-only duplicate e-mail check (§4) in production; apply 0025.
3. Push `main`; confirm the deployment.
4. `pnpm backfill-auth-users` against production, then `pnpm backfill-auth-users --check` → both counts 0 (mandatory checkpoint).
5. User turns off "Allow new users to sign up" in the Supabase dashboard (prod and dev).
6. Verify with an already-provisioned e-mail: Google login and magic link still work; a non-provisioned e-mail gets no account.
7. Check signing keys (§5) and report.
