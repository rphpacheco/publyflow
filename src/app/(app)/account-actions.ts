"use server";

import { headers } from "next/headers";
import { clientIp } from "@/lib/client-ip";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { allowEmailLink } from "@/lib/auth/email-link-limit";
import { sendPasswordLink } from "@/lib/auth/request-password-link";

const GENERIC_ERROR = "Não foi possível enviar o link. Tente novamente.";

export async function requestPasswordChange(): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.toLowerCase();
  if (!email) return { ok: false, error: GENERIC_ERROR };

  const requestHeaders = await headers();
  if (!(await allowEmailLink("password-reset", email, clientIp(requestHeaders)))) {
    return { ok: false, error: "Muitas tentativas. Tente novamente em alguns minutos." };
  }

  const origin = requestHeaders.get("origin");
  if (!origin) return { ok: false, error: GENERIC_ERROR };

  if (!(await sendPasswordLink(email, origin))) return { ok: false, error: GENERIC_ERROR };
  return { ok: true, email };
}
