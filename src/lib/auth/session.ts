import { db } from "@/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveSessionForAuthUser } from "./resolve-session";
import { UnauthenticatedError } from "./errors";
import type { Session } from "./types";

export async function getSession(): Promise<Session | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return resolveSessionForAuthUser(db, { id: data.user.id, email: data.user.email ?? undefined });
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new UnauthenticatedError();
  return session;
}
