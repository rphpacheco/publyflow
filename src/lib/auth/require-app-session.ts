import { redirect } from "next/navigation";
import { getAuthState, type AuthState } from "./session";
import { AuthUnavailableError } from "./errors";
import type { Session } from "./types";

export type AppSessionResult = { status: "ok"; session: Session } | { status: "unavailable" };

/**
 * Session gate for the authenticated layouts ((app) and (preview)).
 * - member → ok
 * - Supabase user without PublyFlow access → /sem-acesso (no sign-out: logout is POST-only)
 * - no Supabase user (proxy let it through) → /login
 * - auth provider unavailable → "unavailable"; the caller renders <SessionUnavailable />
 *   (a thrown error would reach the client without its message in production).
 */
export async function requireAppSession(): Promise<AppSessionResult> {
  let state: AuthState;
  try {
    state = await getAuthState();
  } catch (error) {
    if (error instanceof AuthUnavailableError) return { status: "unavailable" };
    throw error;
  }
  if (state.status === "member") return { status: "ok", session: state.session };
  redirect(state.status === "no-access" ? "/sem-acesso" : "/login");
}
