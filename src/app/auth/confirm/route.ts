import { NextResponse } from "next/server";
import { db } from "@/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveSessionForAuthUser } from "@/lib/auth/resolve-session";
import { recordLoginSafely, redirectToResetWithGrant } from "@/lib/auth/complete-recovery-login";

/**
 * Password-reset link landing. Accepts two link formats:
 * - `token_hash` (custom e-mail template): no code-verifier cookie needed, works on any device;
 * - `code` (default Supabase template, PKCE): only works in the browser that requested the link.
 * `/auth/confirm` is only used as `redirectTo` of password links, so a `code` here is a recovery.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const code = url.searchParams.get("code");
  const expired = () => NextResponse.redirect(new URL("/forgot-password?expired=1", url.origin));

  let authUser: { id: string; email?: string | null; email_confirmed_at?: string | null } | null | undefined;
  const supabase = await createSupabaseServerClient();
  if (tokenHash) {
    if (url.searchParams.get("type") !== "recovery") return expired();
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
    if (error) console.error("Recovery verification failed", (error as { code?: string }).code ?? "unknown");
    authUser = error ? null : data?.user;
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) console.error("Recovery code exchange failed", (error as { code?: string }).code ?? "unknown");
    authUser = error ? null : data?.user;
  } else {
    return expired();
  }
  if (!authUser) return expired();

  const session = await resolveSessionForAuthUser(db, {
    id: authUser.id,
    email: authUser.email ?? undefined,
    emailVerified: Boolean(authUser.email_confirmed_at),
  });
  if (!session) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/sem-acesso", url.origin));
  }

  await recordLoginSafely(session);
  return redirectToResetWithGrant(url.origin, session.userId);
}
