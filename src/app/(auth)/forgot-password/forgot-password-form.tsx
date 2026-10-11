"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";

const initialState: ForgotPasswordState = { sent: false, error: null };

export function ForgotPasswordForm() {
  const [state, formAction, pending] = React.useActionState(requestPasswordReset, initialState);

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      {state.sent ? (
        <p role="status" className="text-sm text-muted-foreground">
          Se houver acesso para este e-mail, enviamos um link para definir a senha.
        </p>
      ) : (
        <form action={formAction} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="forgot-email">
              E-mail
            </label>
            <Input
              id="forgot-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              aria-describedby={state.error ? "forgot-email-error" : undefined}
            />
            {state.error ? (
              <p id="forgot-email-error" role="alert" className="text-sm text-error">
                {state.error}
              </p>
            ) : null}
          </div>
          <Button type="submit" disabled={pending}>
            Enviar link
          </Button>
        </form>
      )}
      <Link href="/login" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        Voltar ao login
      </Link>
    </div>
  );
}
