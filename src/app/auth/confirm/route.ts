import { NextResponse } from "next/server";
import { db } from "@/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveSessionForAuthUser } from "@/lib/auth/resolve-session";
import { recordLoginSafely, redirectToResetWithGrant } from "@/lib/auth/complete-recovery-login";

/**
 * Password-reset link landing (token_hash flow). Unlike the PKCE code flow it
 * needs no code-verifier cookie, so the e-mail can be opened on any device/browser.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const expired = () => NextResponse.redirect(new URL("/forgot-password?expired=1", url.origin));
  if (!tokenHash || type !== "recovery") return expired();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
  if (error || !data?.user) {
    if (error) console.error("Recovery verification failed", (error as { code?: string }).code ?? "unknown");
    return expired();
  }

  const session = await resolveSessionForAuthUser(db, {
    id: data.user.id,
    email: data.user.email,
    emailVerified: Boolean(data.user.email_confirmed_at),
  });
  if (!session) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/sem-acesso", url.origin));
  }

  await recordLoginSafely(session);
  return redirectToResetWithGrant(url.origin, session.userId);
}
