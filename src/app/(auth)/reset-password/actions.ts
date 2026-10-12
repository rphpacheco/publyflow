"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RESET_GRANT_COOKIE } from "@/lib/auth/password-reset-grant";
import { hasValidResetGrant } from "./grant-check";
import { RESET_EXPIRED_MESSAGE, RESET_REAUTH_MESSAGE } from "./messages";

export interface ResetPasswordState {
  error: string | null;
  fieldErrors: { password?: string; confirm?: string };
  code?: "expired";
}

export async function setNewPassword(_prev: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const check = await hasValidResetGrant();
  if (check !== "ok") return { error: RESET_EXPIRED_MESSAGE, fieldErrors: {}, code: "expired" };
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    return { error: null, fieldErrors: { password: "A senha precisa ter entre 8 e 72 caracteres." } };
  }
  if (password !== confirm) return { error: null, fieldErrors: { confirm: "As senhas não conferem." } };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error("Password update failed", error.code ?? "unknown");
    if (error.code === "reauthentication_needed" || error.code === "reauth_nonce_missing") {
      return { error: RESET_REAUTH_MESSAGE, fieldErrors: {}, code: "expired" };
    }
    if (error.code === "same_password") return { error: "A nova senha precisa ser diferente da atual.", fieldErrors: {} };
    if (error.code === "weak_password") {
      return { error: "Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.", fieldErrors: {} };
    }
    return { error: "Não foi possível salvar a senha. Tente novamente.", fieldErrors: {} };
  }
  (await cookies()).delete(RESET_GRANT_COOKIE);
  redirect("/pipeline?senha=ok");
}
