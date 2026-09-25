import { redirect } from "next/navigation";
import { getSession } from "./session";
import type { Session } from "./types";

/**
 * Session gate for the authenticated app layouts ((app) and (preview)).
 * src/proxy.ts already sent visitors without a Supabase user to /login, so a
 * null session here means a Supabase user without PublyFlow access: sign
 * them out and show /sem-acesso.
 */
export async function requireAppSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect("/auth/signout?reason=no-access");
  }
  return session;
}
