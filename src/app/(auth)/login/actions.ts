"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveSessionForAuthUser } from "@/lib/auth/resolve-session";
import { OrganizationMembersRepository } from "@/repositories/organization-members.repository";
import { allowEmailLink } from "@/lib/auth/email-link-limit";
import { emailLinkSchema } from "@/lib/auth/email-schema";
import { clientIp } from "@/lib/client-ip";

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

  const session = await resolveSessionForAuthUser(db, {
    id: data.user.id,
    email: data.user.email,
    emailVerified: Boolean(data.user.email_confirmed_at),
  });
  if (!session) {
    await supabase.auth.signOut();
    redirect("/sem-acesso");
  }
  try {
    await OrganizationMembersRepository.recordLogin(db, session.organizationId, session.userId, new Date());
  } catch (e) {
    // Never let a login-tracking failure block the login itself.
    console.error("recordLogin failed", (e as { code?: string })?.code ?? "unknown");
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

export interface MagicLinkState {
  sent: boolean;
  error: string | null;
}

export async function sendMagicLink(_prev: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { sent: false, error: "Informe seu e-mail." };

  const emailCheck = emailLinkSchema.safeParse(email);
  if (!emailCheck.success) {
    return { sent: false, error: emailCheck.error.issues[0].message };
  }

  const requestHeaders = await headers();
  if (!(await allowEmailLink("magic-link", email, clientIp(requestHeaders)))) {
    return { sent: false, error: "Muitas tentativas. Tente novamente em alguns minutos." };
  }

  const origin = requestHeaders.get("origin") ?? "";
  const supabase = await createSupabaseServerClient();
  // Public sign-up is off: only e-mails provisioned by the server (ensureAuthUser) get a link.
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback`, shouldCreateUser: false },
  });
  // Same answer either way: never reveal whether an e-mail has access.
  if (error) console.error("Magic link request failed", (error as { code?: string }).code ?? "unknown");
  return { sent: true, error: null };
}
