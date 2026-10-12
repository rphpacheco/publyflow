import { NextResponse } from "next/server";
import { db } from "@/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveSessionForAuthUser } from "@/lib/auth/resolve-session";
import { recordLoginSafely, redirectToResetWithGrant } from "@/lib/auth/complete-recovery-login";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  // A failed/expired reset link must not end in the Google error page.
  const resetExpired = () => NextResponse.redirect(new URL("/forgot-password?expired=1", url.origin));
  if (!code) {
    if (next === "reset") return resetExpired();
    // With sign-up off, Google for an e-mail missing from auth.users comes
    // back without a code; retrying never helps, so show the no-access page.
    const description = url.searchParams.get("error_description") ?? "";
    if (url.searchParams.get("error_code") === "signup_disabled" || /signups? not allowed/i.test(description)) {
      return NextResponse.redirect(new URL("/sem-acesso", url.origin));
    }
    return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    if (next === "reset") return resetExpired();
    return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
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
  if (next === "reset") return redirectToResetWithGrant(url.origin, session.userId);
  return NextResponse.redirect(new URL("/pipeline", url.origin));
}
