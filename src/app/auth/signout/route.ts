import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RESET_GRANT_COOKIE } from "@/lib/auth/password-reset-grant";

// Logout changes state, so it is POST-only (no logout CSRF via links/images).
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const response = NextResponse.redirect(new URL("/login", new URL(request.url).origin), { status: 303 });
  // A pending reset grant must not outlive the session.
  response.cookies.set(RESET_GRANT_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
