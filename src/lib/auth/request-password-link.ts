import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Asks Supabase to e-mail a password link. Never throws for Supabase errors (logged by code only). */
export async function sendPasswordLink(email: string, origin: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=reset`,
  });
  if (error) console.error("Password link request failed", (error as { code?: string }).code ?? "unknown");
}
