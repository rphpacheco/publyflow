import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Logout changes state, so it is POST-only (no logout CSRF via links/images).
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", new URL(request.url).origin), { status: 303 });
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
