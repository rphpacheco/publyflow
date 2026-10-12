# Password reset and change (TAREFA item F)

Date: 2026-10-11. Status: approved design (user, 2026-10-11), pending written-spec review.
Origin: Auth v1 subproject 2 leftovers. `/login` offers password, Google and magic link; there is no "forgot password" nor "change password". Only users provisioned with `--password` have a password today; invited gestores/creators log in with Google or magic link. Public sign-up is off (auth hardening, 2026-10-11).

## 1. Decisions

| # | Decision |
|---|---|
| D1 | Scope: "Esqueci minha senha" on `/login` **and** "Alterar senha" inside the app. The same flow also lets a user without a password create one. |
| D2 | In-app change also goes through an e-mail link (proves the mailbox; protects against a stolen open session). One flow for both entry points. |
| D3 | The reset page only works with a member session **and** a valid reset grant for that same user (§3). Without the grant, any open session could change the password directly, defeating D2. The grant protects the app UI; at the API level, protection against a stolen session comes from Supabase "Secure password change" (enabled in the dashboard). |
| D4 | The grant is a signed httpOnly cookie (HMAC-SHA256, key derived from `SUPABASE_SERVICE_ROLE_KEY` with the label `password-reset-v1`), valid 15 minutes, single use. No new env var, no migration. |
| D5 | E-mails are sent by Supabase (`resetPasswordForEmail`), same channel and limits as the magic link. Translating the Supabase "Reset password" template and custom SMTP are dashboard/config work outside this spec. |
| D6 | Paths in English like the rest of the app (`/forgot-password`, `/reset-password`); visible copy in Portuguese. |

## 2. Flows

### 2.1 Forgot password (no session)
- `/login`: link "Esqueci minha senha" under the password form → `/forgot-password` (public path, added to `src/lib/auth/public-paths.ts`).
- `/forgot-password` (title "Redefinir senha"): field "E-mail", button "Enviar link", link "Voltar ao login".
- Server action `requestPasswordReset` (in `src/app/(auth)/forgot-password/actions.ts`):
  - same e-mail validation and **same rate limit** as the magic link (`{ limit: 5, windowSeconds: 600 }`, scopes `password-reset:ip` and `password-reset:email`); over the limit → "Muitas tentativas. Tente novamente em alguns minutos.";
  - `supabase.auth.resetPasswordForEmail(email, { redirectTo: \`${origin}/auth/confirm\` })` (token_hash flow, see §2.3; the Supabase "Reset password" template links to `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`, so dev and prod each use their own origin); missing `origin` header → same generic answer without calling Supabase;
  - always answers "Se houver acesso para este e-mail, enviamos um link para definir a senha." (never reveals who has an account; Supabase errors are logged by code only).

### 2.2 Change password (logged in)
- Header: the "Sair" button becomes an account menu (lucide `CircleUser`, aria-label "Conta") with "Alterar senha" and "Sair" (POST form, unchanged behavior).
- "Alterar senha" calls server action `requestPasswordChange`: session required (else no-op error), same rate limit scopes keyed by the session e-mail and IP, `resetPasswordForEmail(sessionEmail, { redirectTo: …/auth/confirm })`. Toast "Enviamos um link para {email}. Abra-o para definir a nova senha." (the e-mail is the user's own). Errors → toast "Não foi possível enviar o link. Tente novamente.".

### 2.3 Confirm route (token_hash) and callback
The e-mail link uses Supabase's token_hash flow instead of PKCE: PKCE needs the code-verifier cookie set in the browser that requested the link, so it fails when the e-mail is opened on another device/browser. token_hash needs no cookie and works anywhere.

`src/app/auth/confirm/route.ts` (GET, public under `/auth`): reads `token_hash` and `type`; `type !== "recovery"` or missing `token_hash` → `/forgot-password?expired=1`. Otherwise `supabase.auth.verifyOtp({ token_hash, type: "recovery" })`; error or no user → `/forgot-password?expired=1` (only `error.code` logged). Then the same member resolution as the callback (`resolveSessionForAuthUser`): no access → `signOut` + `/sem-acesso`, no grant. Member → `recordLogin` (failures never block), set the reset grant cookie for that user and redirect to `/reset-password`. The shared steps live in `src/lib/auth/complete-recovery-login.ts`. The grant is thus only minted by a recovery verification.

Legacy: `src/app/auth/callback/route.ts` keeps its `next=reset` branch (links sent with the old template still work): after a successful exchange **and** a resolved member session, when `next=reset`, set the grant cookie and redirect to `/reset-password`; no access → `/sem-acesso` (no grant); any other `next` value is ignored (no open redirect); `next=reset` with no `code` or a failed exchange → `/forgot-password?expired=1`; all other failures keep `/login?error=oauth`.

### 2.4 Reset page `/reset-password`
- Server component in the `(auth)` group (no app shell). Reads `getAuthState()`:
  - provider unavailable → `SessionUnavailable`;
  - not a member, or no valid grant for `session.userId` → message "Este link expirou ou já foi usado. Peça um novo link." + button "Pedir novo link" → `/forgot-password`;
  - member with a valid grant → form.
- Form (title "Definir nova senha"): "Nova senha", "Confirmar senha" (`type="password"`, `autoComplete="new-password"`), button "Salvar senha".
- Server action `setNewPassword`:
  - re-checks member session + grant (the page check is not trusted);
  - validation: 8–72 characters ("A senha precisa ter entre 8 e 72 caracteres."), both equal ("As senhas não conferem.");
  - `supabase.auth.updateUser({ password })`; error mapping: `same_password` → "A nova senha precisa ser diferente da atual."; `weak_password` → "Senha fraca. Use pelo menos 8 caracteres, misturando letras e números."; anything else → "Não foi possível salvar a senha. Tente novamente." (logged by code only);
  - on success: delete the grant cookie (single use) and `redirect("/pipeline?senha=ok")`; the app shows the toast "Senha definida." once (client reads the param and removes it with `router.replace`).

## 3. Reset grant (cookie)
- Module `src/lib/auth/password-reset-grant.ts` (server-only use):
  - `createResetGrant(userId: string, now = Date.now()): string` → `base64url(userId + "." + expiresAtMs) + "." + base64url(hmac)`;
  - `verifyResetGrant(token: string | undefined, userId: string, now = Date.now()): boolean` → constant-time HMAC compare (`crypto.timingSafeEqual`), not expired, same user;
  - key: `HMAC-SHA256(SUPABASE_SERVICE_ROLE_KEY, "password-reset-v1")`; missing env → grants never verify (page shows the expired message) and creation throws a clear server error logged by code.
- Cookie `pf_pw_reset`: `httpOnly`, `secure` in production, `sameSite: "lax"`, `path: "/"`, `maxAge` 900 seconds.

## 4. UI rules
Lucide icons only, no emoji/symbol glyphs; Portuguese copy; no content overflowing containers at 320–1920px; same visual style as `/login` (centered, `max-w-sm`). Field errors under inputs with `role="alert"` and `aria-describedby`.

## 5. Tests
- Grant: valid → true; other user → false; expired → false; tampered payload or signature → false; missing env → false.
- `requestPasswordReset`: generic answer for valid/unknown e-mail; rate limit; invalid e-mail message; calls Supabase with `redirectTo` ending `/auth/confirm`; Supabase error → same generic answer.
- `requestPasswordChange`: uses the session e-mail; rate limit; no session → error.
- Confirm route: missing `token_hash` / non-recovery `type` → expired (no verify); verify error → expired; no access → `/sem-acesso` + signOut, no cookie; member → `/reset-password` with a valid grant and `recordLogin`; `recordLogin` failure still redirects with the grant.
- Callback (legacy): `next=reset` + member → sets `pf_pw_reset` and redirects `/reset-password`; no access → `/sem-acesso` without cookie; other `next` ignored.
- Reset page: unavailable state; no grant / other user's grant / non-member → expired message; valid → form.
- `setNewPassword`: re-checks grant; validation messages; Supabase error mapping; success deletes cookie and redirects; a second submit after success → expired message.
- Header menu: "Alterar senha" and "Sair" (POST) present; toast on success.
- Manual (browser): forgot flow end to end with the user's e-mail (Supabase dev = prod project); change flow from the header; the link used twice → expired; login with the new password.

## 6. Deploy
No migration, no new env var. Before pushing, confirm in the Supabase dashboard (Authentication → URL Configuration → Redirect URLs) that `…/auth/confirm` is allowed for production and dev (exact entries without the query would make Supabase fall back to the Site URL; use `https://publyflow.vercel.app/**` and `http://localhost:3000/**`, `http://localhost:3001/**`). Push `main`; verify `/forgot-password` in production. Enable "Secure password change" in the Supabase dashboard (Authentication, Sign In / Providers, Email) so API-level password changes require recent re-authentication. **Before deploying, change the Supabase "Reset password" e-mail template** (Authentication, Email Templates) so the link is `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery` (the default `{{ .ConfirmationURL }}` would keep using PKCE); the text may also be translated to Portuguese.

## 7. Out of scope
Custom SMTP / e-mail branding beyond the Supabase template; password strength meter; MFA; forcing logout of other sessions after a password change; changing e-mail address.
