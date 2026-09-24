import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function signOut(request: Request) {
  const url = new URL(request.url);
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const target = url.searchParams.get("reason") === "no-access" ? "/sem-acesso" : "/login";
  return NextResponse.redirect(new URL(target, url.origin), { status: 303 });
}

export { signOut as GET, signOut as POST };
