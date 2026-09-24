"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveSessionForAuthUser } from "@/lib/auth/resolve-session";

export interface LoginState {
  error: string | null;
}

export async function loginWithPassword(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Informe e-mail e senha." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return { error: "E-mail ou senha inválidos." };
  }

  const session = await resolveSessionForAuthUser(db, { id: data.user.id, email: data.user.email });
  if (!session) {
    await supabase.auth.signOut();
    redirect("/sem-acesso");
  }
  redirect("/pipeline");
}

export async function loginWithGoogle(): Promise<void> {
  const origin = (await headers()).get("origin");
  if (!origin) {
    redirect("/login?error=oauth");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback` },
  });
  if (error || !data.url) {
    redirect("/login?error=oauth");
  }
  redirect(data.url);
}
