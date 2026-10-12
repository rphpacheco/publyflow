import { NextResponse } from "next/server";
import { db } from "@/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveSessionForAuthUser } from "@/lib/auth/resolve-session";
import {
  RESET_GRANT_COOKIE,
  createResetGrant,
  resetGrantCookieOptions,
} from "@/lib/auth/password-reset-grant";
import { OrganizationMembersRepository } from "@/repositories/organization-members.repository";

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

  try {
    await OrganizationMembersRepository.recordLogin(db, session.organizationId, session.userId, new Date());
  } catch (e) {
    // Never let a login-tracking failure block the login itself.
    console.error("recordLogin failed", (e as { code?: string })?.code ?? "unknown");
  }
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
}
