"use server";

import { headers } from "next/headers";
import { clientIp } from "@/lib/client-ip";
import { emailLinkSchema } from "@/lib/auth/email-schema";
import { allowEmailLink } from "@/lib/auth/email-link-limit";
import { sendPasswordLink } from "@/lib/auth/request-password-link";

export interface ForgotPasswordState {
  sent: boolean;
  error: string | null;
}

export async function requestPasswordReset(_prev: ForgotPasswordState, formData: FormData): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !emailLinkSchema.safeParse(email).success) return { sent: false, error: "Informe um e-mail válido." };

  const requestHeaders = await headers();
  if (!(await allowEmailLink("password-reset", email, clientIp(requestHeaders)))) {
    return { sent: false, error: "Muitas tentativas. Tente novamente em alguns minutos." };
  }

  const origin = requestHeaders.get("origin");
  if (origin) await sendPasswordLink(email, origin);
  // Same answer either way: never reveal whether an e-mail has access.
  return { sent: true, error: null };
}
