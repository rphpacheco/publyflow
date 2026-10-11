# Password Reset and Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Esqueci minha senha" on `/login` and "Alterar senha" in the app, both sending a Supabase e-mail link that opens a "Definir nova senha" page guarded by a signed, single-use reset grant.

**Architecture:** Server actions call `supabase.auth.resetPasswordForEmail` with `redirectTo …/auth/callback?next=reset`; the existing callback, after a successful exchange for a member, sets an HMAC-signed httpOnly cookie (`pf_pw_reset`, 15 min) and redirects to `/reset-password`, whose server action re-checks the grant and calls `supabase.auth.updateUser({ password })`.

**Tech Stack:** Next.js 16 App Router (server actions, `cookies()` from `next/headers` is async), React 19 (`useActionState`), `@supabase/ssr` / `@supabase/supabase-js`, Node `crypto`, Vitest + Testing Library, lucide-react, sonner.

**Spec:** `docs/superpowers/specs/2026-10-11-password-reset-design.md` (authoritative).

## Global Constraints

- Copy (Portuguese, verbatim):
  - `/login` link "Esqueci minha senha"; `/forgot-password` title "Redefinir senha", field "E-mail", button "Enviar link", link "Voltar ao login"; answer "Se houver acesso para este e-mail, enviamos um link para definir a senha."; rate limit "Muitas tentativas. Tente novamente em alguns minutos."; invalid e-mail "Informe um e-mail válido.".
  - Account menu: aria-label "Conta" (lucide `CircleUser`), items "Alterar senha" and "Sair"; toasts "Enviamos um link para {email}. Abra-o para definir a nova senha." / "Não foi possível enviar o link. Tente novamente.".
  - `/reset-password` title "Definir nova senha", fields "Nova senha", "Confirmar senha", button "Salvar senha"; expired "Este link expirou ou já foi usado. Peça um novo link." + button "Pedir novo link"; validation "A senha precisa ter entre 8 e 72 caracteres.", "As senhas não conferem."; errors "A nova senha precisa ser diferente da atual." (`same_password`), "Senha fraca. Use pelo menos 8 caracteres, misturando letras e números." (`weak_password`), "Não foi possível salvar a senha. Tente novamente." (other); success toast "Senha definida.".
- Never reveal whether an e-mail has an account; Supabase errors logged by `code` only, never sent to the client.
- Rate limit for both link senders: `{ limit: 5, windowSeconds: 600 }`, scopes `password-reset:ip` and `password-reset:email`.
- `redirectTo` is always `${origin}/auth/callback?next=reset`; the callback ignores any other `next` value (no open redirect).
- Reset grant: cookie `pf_pw_reset`, `httpOnly`, `secure` in production, `sameSite: "lax"`, `path: "/"`, `maxAge` 900; HMAC-SHA256 with key = HMAC-SHA256(`SUPABASE_SERVICE_ROLE_KEY`, `"password-reset-v1"`); constant-time compare; single use (deleted after a successful change); missing env → never verifies.
- The reset page and its action both re-check: member session (`getAuthState()` status `member`) **and** a valid grant for `session.userId`.
- Lucide icons only, no emoji/symbol glyphs; no overflow at 320–1920px; field errors under inputs with `role="alert"` + `aria-describedby`.
- Tests: `/opt/homebrew/bin/pnpm vitest run --dir src <files> --testTimeout=60000 --hookTimeout=60000`; never two vitest processes at once; `pnpm tsc --noEmit`. No migration. **No database operations by subagents.**

## File map

| File | Responsibility |
|---|---|
| `src/lib/auth/password-reset-grant.ts` (new) | create/verify grant, cookie name/options |
| `src/lib/auth/email-link-limit.ts` (new) | shared rate-limit check for e-mail links |
| `src/app/auth/callback/route.ts` | `next=reset` → grant cookie + `/reset-password` |
| `src/app/(auth)/forgot-password/{page.tsx,forgot-password-form.tsx,actions.ts}` (new) | forgot flow |
| `src/app/(auth)/login/login-form.tsx`, `src/lib/auth/public-paths.ts` | link + public path |
| `src/app/(auth)/reset-password/{page.tsx,reset-password-form.tsx,actions.ts}` (new) | set new password |
| `src/components/shell/account-menu.tsx` (new), `src/components/shell/header.tsx`, `src/app/(app)/account-actions.ts` (new) | account menu + password change action |
| `src/components/shell/password-changed-toast.tsx` (new), `src/app/(app)/layout.tsx` | one-time "Senha definida." toast |
| `src/lib/auth/request-password-link.ts` (new) | shared `sendPasswordLink(email)` used by both actions |

---

### Task 1: Reset grant + callback

**Files:**
- Create: `src/lib/auth/password-reset-grant.ts`, `src/lib/auth/password-reset-grant.test.ts`
- Modify: `src/app/auth/callback/route.ts`; Test: `src/app/auth/callback/route.test.ts` (exists — extend)

**Interfaces:**
- Produces:
  - `RESET_GRANT_COOKIE = "pf_pw_reset"`, `RESET_GRANT_MAX_AGE_SECONDS = 900`
  - `resetGrantCookieOptions(): { httpOnly: true; secure: boolean; sameSite: "lax"; path: "/"; maxAge: number }` (`secure` = `process.env.NODE_ENV === "production"`)
  - `createResetGrant(userId: string, now?: number): string` (throws `Error("password reset grant key unavailable")` without the env var)
  - `verifyResetGrant(token: string | undefined, userId: string, now?: number): boolean`

- [ ] **Step 1: Failing tests** — `password-reset-grant.test.ts` (`vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_test")` in `beforeEach`, `vi.unstubAllEnvs()` after):
  - created token verifies for the same user at `now + 899_000`;
  - fails at `now + 900_001` (expired);
  - fails for another user id;
  - fails if any character of the payload part or of the signature part is changed;
  - fails for `undefined`, `""`, `"a.b.c"`, garbage;
  - with the env var empty: `verifyResetGrant` → false and `createResetGrant` throws;
  - `resetGrantCookieOptions()` → `{ httpOnly: true, sameSite: "lax", path: "/", maxAge: 900, secure: false }` in test env.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export const RESET_GRANT_COOKIE = "pf_pw_reset";
export const RESET_GRANT_MAX_AGE_SECONDS = 900;

// Proves the holder opened a password e-mail link for this user within the
// last 15 minutes (spec D3/D4). Server-only: never import from "use client".
function grantKey(): Buffer | null {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return createHmac("sha256", secret).update("password-reset-v1").digest();
}

const b64 = (value: string | Buffer) => Buffer.from(value).toString("base64url");

export function resetGrantCookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/" as const,
    maxAge: RESET_GRANT_MAX_AGE_SECONDS,
  };
}

export function createResetGrant(userId: string, now = Date.now()): string {
  const key = grantKey();
  if (!key) throw new Error("password reset grant key unavailable");
  const payload = b64(`${userId}.${now + RESET_GRANT_MAX_AGE_SECONDS * 1000}`);
  const signature = b64(createHmac("sha256", key).update(payload).digest());
  return `${payload}.${signature}`;
}

export function verifyResetGrant(token: string | undefined, userId: string, now = Date.now()): boolean {
  const key = grantKey();
  if (!key || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  const expected = Buffer.from(createHmac("sha256", key).update(payload).digest());
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  const dot = decoded.lastIndexOf(".");
  if (dot <= 0) return false;
  const tokenUser = decoded.slice(0, dot);
  const expiresAt = Number(decoded.slice(dot + 1));
  return tokenUser === userId && Number.isFinite(expiresAt) && now <= expiresAt;
}
```

- [ ] **Step 4: Callback** — in `src/app/auth/callback/route.ts`, read `const next = url.searchParams.get("next");` and replace the final `return NextResponse.redirect(new URL("/pipeline", url.origin));` with:

```ts
  if (next === "reset") {
    const response = NextResponse.redirect(new URL("/reset-password", url.origin));
    try {
      response.cookies.set(RESET_GRANT_COOKIE, createResetGrant(session.userId), resetGrantCookieOptions());
    } catch (e) {
      // Without the key no grant is possible; the reset page shows "expired".
      console.error("reset grant unavailable", (e as Error).message);
    }
    return response;
  }
  return NextResponse.redirect(new URL("/pipeline", url.origin));
```

Callback tests (extend the existing file; stub the env var): `next=reset` + member → 307 to `/reset-password` and a `set-cookie` header for `pf_pw_reset` with `HttpOnly`, `Max-Age=900`, `Path=/`, `SameSite=lax` (case-insensitive); member without `next` → `/pipeline`, no grant cookie; `next=/evil` → `/pipeline`, no cookie; no access (`resolveSessionForAuthUser` null) with `next=reset` → `/sem-acesso`, no grant cookie; `signup_disabled` behavior unchanged.

- [ ] **Step 5: Run** both files → PASS; `pnpm tsc --noEmit`.
- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/password-reset-grant.ts src/lib/auth/password-reset-grant.test.ts src/app/auth/callback
git commit -m "feat(auth): signed password-reset grant set by the callback for next=reset"
```

---

### Task 2: Forgot-password flow

**Files:**
- Create: `src/lib/auth/email-link-limit.ts` (+ test), `src/lib/auth/request-password-link.ts` (+ test), `src/app/(auth)/forgot-password/page.tsx`, `src/app/(auth)/forgot-password/forgot-password-form.tsx` (+ test), `src/app/(auth)/forgot-password/actions.ts` (+ test)
- Modify: `src/app/(auth)/login/login-form.tsx` (+ test), `src/app/(auth)/login/actions.ts` (use the shared limiter), `src/lib/auth/public-paths.ts` (+ test)

**Interfaces:**
- Consumes: `checkRateLimit` (`src/lib/rate-limit.ts`), `clientIp` (`src/lib/client-ip.ts`), `createSupabaseServerClient`, `db`.
- Produces:
  - `allowEmailLink(scope: "magic-link" | "password-reset", email: string, ip: string): Promise<boolean>` — both `${scope}:ip` and `${scope}:email` buckets with `{ limit: 5, windowSeconds: 600 }`; true only when both allow.
  - `sendPasswordLink(email: string, origin: string): Promise<void>` — `resetPasswordForEmail(email, { redirectTo: \`${origin}/auth/callback?next=reset\` })`; logs `error.code` on failure, never throws for Supabase errors.
  - `interface ForgotPasswordState { sent: boolean; error: string | null }`; `requestPasswordReset(prev, formData): Promise<ForgotPasswordState>`.

- [ ] **Step 1: Shared limiter** — move the two `checkRateLimit` calls of `sendMagicLink` (`src/app/(auth)/login/actions.ts:85-86`) into `allowEmailLink` and call it from `sendMagicLink` with scope `"magic-link"` (same buckets as today, so behavior is unchanged; existing `actions.test.ts` must stay green). Unit test `allowEmailLink` with `checkRateLimit` mocked: both allowed → true; either denied → false; scopes/keys passed exactly (`password-reset:ip` with the ip, `password-reset:email` with the e-mail in the `ip` field — the same convention `sendMagicLink` uses today).

- [ ] **Step 2: `sendPasswordLink`** + test (mock `@/lib/supabase/server`): calls `resetPasswordForEmail` with the exact `redirectTo`; a returned `{ error: { code: "over_email_send_rate_limit" } }` is logged (`console.error("Password link request failed", code)`) and not thrown.

- [ ] **Step 3: Action** `src/app/(auth)/forgot-password/actions.ts` (`"use server"`), modeled on `sendMagicLink`:

```ts
export async function requestPasswordReset(_prev: ForgotPasswordState, formData: FormData): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !emailSchema.safeParse(email).success) return { sent: false, error: "Informe um e-mail válido." };
  const requestHeaders = await headers();
  if (!(await allowEmailLink("password-reset", email, clientIp(requestHeaders)))) {
    return { sent: false, error: "Muitas tentativas. Tente novamente em alguns minutos." };
  }
  const origin = requestHeaders.get("origin");
  if (origin) await sendPasswordLink(email, origin);
  // Same answer either way: never reveal whether an e-mail has access.
  return { sent: true, error: null };
}
```

(`emailSchema` = the same `z.email(...).max(254, ...)` used by `magicLinkEmailSchema`; export that schema from `login/actions.ts` or move it to `src/lib/auth/email-schema.ts` and reuse — do not duplicate the literal.) Tests: invalid e-mail; rate limited; valid → `sent: true` and `sendPasswordLink` called with origin; no origin → `sent: true`, not called.

- [ ] **Step 4: Page + form** — `page.tsx` (server): same layout as `src/app/(auth)/login/page.tsx` (`main` centered, `max-w-sm`), `<h1>` "Redefinir senha", `<ForgotPasswordForm />`. `forgot-password-form.tsx` (`"use client"`, `useActionState(requestPasswordReset, { sent: false, error: null })`): label "E-mail" bound to input (`type="email"`, `autoComplete="email"`, `required`), error under the input (`role="alert"`, `aria-describedby`), button "Enviar link" disabled while pending; when `sent` show `role="status"` "Se houver acesso para este e-mail, enviamos um link para definir a senha."; link "Voltar ao login" (`next/link` to `/login`) always.
- [ ] **Step 5: Login link + public path** — in `login-form.tsx`, under the password "Entrar" button, a `next/link` "Esqueci minha senha" to `/forgot-password` (`text-sm`). Add `"/forgot-password"` to `PUBLIC_PREFIXES` in `src/lib/auth/public-paths.ts` and its test.
- [ ] **Step 6: Run** touched tests (+ `src/app/(auth)/login`) and `pnpm tsc --noEmit`.
- [ ] **Step 7: Commit**

```bash
git add src/lib/auth "src/app/(auth)"
git commit -m "feat(auth): forgot-password page sends a Supabase reset link"
```

---

### Task 3: Reset-password page

**Files:**
- Create: `src/app/(auth)/reset-password/page.tsx` (+ test), `src/app/(auth)/reset-password/reset-password-form.tsx` (+ test), `src/app/(auth)/reset-password/actions.ts` (+ test), `src/components/shell/password-changed-toast.tsx` (+ test)
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `getAuthState()` / `AuthState` (`src/lib/auth/session.ts`), `AuthUnavailableError`, `SessionUnavailable` (`src/components/auth/session-unavailable.tsx`), Task 1 grant API, `createSupabaseServerClient`, `cookies()` from `next/headers`.
- Produces: `interface ResetPasswordState { error: string | null; fieldErrors: { password?: string; confirm?: string } }`; `setNewPassword(prev, formData): Promise<ResetPasswordState>`; `PasswordChangedToast` (client).

- [ ] **Step 1: Shared guard** in `actions.ts` (also used by the page):

```ts
export async function hasValidResetGrant(): Promise<"ok" | "expired" | "unavailable"> {
  let state: AuthState;
  try {
    state = await getAuthState();
  } catch (e) {
    if (e instanceof AuthUnavailableError) return "unavailable";
    throw e;
  }
  if (state.status !== "member") return "expired";
  const token = (await cookies()).get(RESET_GRANT_COOKIE)?.value;
  return verifyResetGrant(token, state.session.userId) ? "ok" : "expired";
}
```

(Put it in a non-`"use server"` module, e.g. `src/app/(auth)/reset-password/grant-check.ts`, if Next forbids exporting non-action helpers from a `"use server"` file — check `node_modules/next/dist/docs` for server actions.)

- [ ] **Step 2: Action** `setNewPassword`:

```ts
export async function setNewPassword(_prev: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const check = await hasValidResetGrant();
  if (check !== "ok") return { error: "Este link expirou ou já foi usado. Peça um novo link.", fieldErrors: {} };
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8 || password.length > 72) {
    return { error: null, fieldErrors: { password: "A senha precisa ter entre 8 e 72 caracteres." } };
  }
  if (password !== confirm) return { error: null, fieldErrors: { confirm: "As senhas não conferem." } };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error("Password update failed", error.code ?? "unknown");
    if (error.code === "same_password") return { error: "A nova senha precisa ser diferente da atual.", fieldErrors: {} };
    if (error.code === "weak_password") {
      return { error: "Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.", fieldErrors: {} };
    }
    return { error: "Não foi possível salvar a senha. Tente novamente.", fieldErrors: {} };
  }
  (await cookies()).delete(RESET_GRANT_COOKIE);
  redirect("/pipeline?senha=ok");
}
```

Tests (mock `@/lib/auth/session`, `@/lib/supabase/server`, `next/headers` cookies with a Map-backed store, `next/navigation` redirect throwing a signal): no grant / other user's grant / non-member → expired error, `updateUser` not called; 7 and 73 chars → length message; mismatch → confirm message; `same_password` / `weak_password` / other mapped; success → `updateUser({ password })`, cookie deleted, redirect `/pipeline?senha=ok`; a second call after success → expired.

- [ ] **Step 3: Page** (server): `hasValidResetGrant()` → `"unavailable"` → `<SessionUnavailable />`; `"expired"` → centered `max-w-sm` block with the expired text and a button/link "Pedir novo link" to `/forgot-password`; `"ok"` → `<h1>` "Definir nova senha" + `<ResetPasswordForm />`. Page tests for the three states.
- [ ] **Step 4: Form** (`"use client"`, `useActionState(setNewPassword, { error: null, fieldErrors: {} })`): "Nova senha" (`name="password"`) and "Confirmar senha" (`name="confirm"`), both `type="password"`, `autoComplete="new-password"`, `minLength={8}`, `maxLength={72}`, `required`; field errors under each (`role="alert"`, `aria-describedby`); top error `role="alert"`; button "Salvar senha" disabled while pending. When the top error is the expired message, also show the "Pedir novo link" link. Tests: renders labels; shows field/top errors from state.
- [ ] **Step 5: One-time toast** — `PasswordChangedToast` (`"use client"`): `useSearchParams()`; when `senha === "ok"`, `toast.success("Senha definida.")` once and `router.replace(pathname)` without the param. Render it in `src/app/(app)/layout.tsx` inside `<React.Suspense fallback={null}>` (required by Next for `useSearchParams`). Test: with `?senha=ok` → toast once + replace called; without → nothing.
- [ ] **Step 6: Run** touched tests + `pnpm tsc --noEmit`.
- [ ] **Step 7: Commit**

```bash
git add "src/app/(auth)/reset-password" src/components/shell/password-changed-toast.tsx src/components/shell/password-changed-toast.test.tsx "src/app/(app)/layout.tsx"
git commit -m "feat(auth): reset-password page guarded by the signed grant"
```

---

### Task 4: Account menu with "Alterar senha"

**Files:**
- Create: `src/components/shell/account-menu.tsx` (+ test), `src/app/(app)/account-actions.ts` (+ test)
- Modify: `src/components/shell/header.tsx` (+ test if present)

**Interfaces:**
- Consumes: `allowEmailLink`, `sendPasswordLink` (Task 2), `createSupabaseServerClient`, `clientIp`, `headers()`.
- Produces: `requestPasswordChange(): Promise<{ ok: true; email: string } | { ok: false; error: string }>` (server action).

- [ ] **Step 1: Action** (`"use server"`):

```ts
export async function requestPasswordChange(): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.toLowerCase();
  if (!email) return { ok: false, error: "Não foi possível enviar o link. Tente novamente." };
  const requestHeaders = await headers();
  if (!(await allowEmailLink("password-reset", email, clientIp(requestHeaders)))) {
    return { ok: false, error: "Muitas tentativas. Tente novamente em alguns minutos." };
  }
  const origin = requestHeaders.get("origin");
  if (!origin) return { ok: false, error: "Não foi possível enviar o link. Tente novamente." };
  await sendPasswordLink(email, origin);
  return { ok: true, email };
}
```

Tests: no user → error; rate limited → message; success → `sendPasswordLink(email, origin)` and `{ ok: true, email }`.

- [ ] **Step 2: Menu** (`"use client"`) using `src/components/ui/dropdown-menu.tsx`: trigger `Button variant="ghost" size="icon" aria-label="Conta"` with lucide `CircleUser`; item "Alterar senha" → `startTransition(async () => { const r = await requestPasswordChange(); r.ok ? toast.success(\`Enviamos um link para ${r.email}. Abra-o para definir a nova senha.\`) : toast.error(r.error); })` (disabled while pending); item "Sair" as a POST form: `<form action="/auth/signout" method="post"><DropdownMenuItem asChild><button type="submit" className="w-full text-left">Sair</button></DropdownMenuItem></form>` (verify the Radix item still submits; if not, render the form outside the menu content and submit it via a ref).
- [ ] **Step 3: Header** — replace `<SignOutButton label="Sair" variant="ghost" size="sm" />` with `<AccountMenu />` (keep `SignOutButton` itself: `/sem-acesso` and `/login` use it).
- [ ] **Step 4: Tests** — menu: opening shows "Alterar senha" and "Sair"; "Sair" is inside a POST form to `/auth/signout`; success toast text with the e-mail; error toast; no glyphs. Run `src/components/shell` + new tests + `pnpm tsc --noEmit`.
- [ ] **Step 5: Commit**

```bash
git add src/components/shell "src/app/(app)/account-actions.ts" "src/app/(app)/account-actions.test.ts"
git commit -m "feat(auth): account menu with password change link"
```

---

### Task 5: Verification (controller)

- [ ] `pnpm tsc --noEmit`; `pnpm lint` (no new errors in touched files); full suite; build (command in CLAUDE.md).
- [ ] User confirms Supabase Redirect URLs allow `…/auth/callback?next=reset` (wildcards `https://publyflow.vercel.app/**`, `http://localhost:3000/**`, `http://localhost:3001/**`).
- [ ] Browser (dev, user's own e-mail — dev and prod share the Supabase project): forgot flow from `/login` → e-mail → link → "Definir nova senha" → save → `/pipeline` + toast "Senha definida." → logout → login with the new password; open the same link again → expired; "Alterar senha" from the header → e-mail → same page; layout 320–1920px.
- [ ] Final whole-branch review; merge + push (no migration); confirm `/forgot-password` in production.
