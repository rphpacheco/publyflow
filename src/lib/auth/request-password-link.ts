import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Asks Supabase to e-mail a password link. Never throws (errors are logged by code/name only).
 * Resolves true when Supabase accepted the request, false otherwise.
 */
export async function sendPasswordLink(email: string, origin: string): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=reset`,
    });
    if (error) {
      console.error("Password link request failed", (error as { code?: string }).code ?? "unknown");
      return false;
    }
    return true;
  } catch (error) {
    console.error("Password link request threw", (error as Error).name);
    return false;
  }
}
