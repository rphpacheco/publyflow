import { cache } from "react";
import { db } from "@/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveSessionForAuthUser } from "./resolve-session";
import { AuthUnavailableError, UnauthenticatedError, isAuthServiceFailure, logAuthUnavailable } from "./errors";
import type { Session } from "./types";

export type AuthState =
  | { status: "anonymous" }
  | { status: "no-access"; email: string | null }
  | { status: "member"; session: Session };

// One Supabase getUser() per server render: layouts and pages share it.
// Authorization always comes from here (getUser + membership), never from
// JWT claims (src/proxy.ts uses getClaims() only to decide its redirect).
export const getAuthState = cache(async (): Promise<AuthState> => {
  const supabase = await createSupabaseServerClient();
  let result: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    result = await supabase.auth.getUser();
  } catch (error) {
    if (isAuthServiceFailure(error)) {
      logAuthUnavailable(error);
      throw new AuthUnavailableError();
    }
    throw error;
  }
  const { data, error } = result;
  if (error && isAuthServiceFailure(error)) {
    logAuthUnavailable(error);
    throw new AuthUnavailableError();
  }
  if (error || !data.user) return { status: "anonymous" };

  const session = await resolveSessionForAuthUser(db, {
    id: data.user.id,
    email: data.user.email ?? undefined,
    emailVerified: Boolean(data.user.email_confirmed_at),
  });
  return session ? { status: "member", session } : { status: "no-access", email: data.user.email ?? null };
});

export async function getSession(): Promise<Session | null> {
  const state = await getAuthState();
  return state.status === "member" ? state.session : null;
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new UnauthenticatedError();
  return session;
}
