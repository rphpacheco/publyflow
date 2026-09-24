import { NextResponse } from "next/server";
import { db } from "@/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveSessionForAuthUser } from "@/lib/auth/resolve-session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
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

  return NextResponse.redirect(new URL("/pipeline", url.origin));
}
