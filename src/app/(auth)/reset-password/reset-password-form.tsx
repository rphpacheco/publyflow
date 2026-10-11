"use client";

import * as React from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { setNewPassword, type ResetPasswordState } from "./actions";

const initialState: ResetPasswordState = { error: null, fieldErrors: {} };
const EXPIRED = "Este link expirou ou já foi usado. Peça um novo link.";

export function ResetPasswordForm() {
  const [state, formAction, pending] = React.useActionState(setNewPassword, initialState);
  const { password: passwordError, confirm: confirmError } = state.fieldErrors;

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-3">
      {state.error ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-error">
            {state.error}
          </p>
          {state.error === EXPIRED ? (
            <Link href="/forgot-password" className={cn(buttonVariants({ variant: "outline" }))}>
              Pedir novo link
            </Link>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="reset-password">
          Nova senha
        </label>
        <Input
          id="reset-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
          required
          aria-describedby={passwordError ? "reset-password-error" : undefined}
        />
        {passwordError ? (
          <p id="reset-password-error" role="alert" className="text-sm text-error">
            {passwordError}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="reset-confirm">
          Confirmar senha
        </label>
        <Input
          id="reset-confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
          required
          aria-describedby={confirmError ? "reset-confirm-error" : undefined}
        />
        {confirmError ? (
          <p id="reset-confirm-error" role="alert" className="text-sm text-error">
            {confirmError}
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={pending}>
        Salvar senha
      </Button>
    </form>
  );
}
