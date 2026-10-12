import { cookies } from "next/headers";
import { getAuthState, type AuthState } from "@/lib/auth/session";
import { AuthUnavailableError } from "@/lib/auth/errors";
import { RESET_GRANT_COOKIE, verifyResetGrant } from "@/lib/auth/password-reset-grant";

// Shared by the page and the action: a member session AND a valid grant for that user.
export async function hasValidResetGrant(): Promise<"ok" | "expired" | "unavailable"> {
  let state: AuthState;
  try {
    state = await getAuthState();
  } catch (e) {
    if (e instanceof AuthUnavailableError) return "unavailable";
    throw e;
  }
  if (state.status !== "member") return "expired";
  const token = (await cookies()).get(RESET_GRANT_COOKIE)?.value;
  return verifyResetGrant(token, state.session.userId) ? "ok" : "expired";
}
