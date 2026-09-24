"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginWithGoogle, loginWithPassword, type LoginState } from "./actions";

const initialState: LoginState = { error: null };

export function LoginForm({ oauthError }: { oauthError: boolean }) {
  const [state, formAction, pending] = React.useActionState(loginWithPassword, initialState);
  const error = state.error ?? (oauthError ? "Não foi possível entrar com o Google. Tente novamente." : null);

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="email">
            E-mail
          </label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="password">
            Senha
          </label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending}>
          Entrar
        </Button>
      </form>
      <form action={loginWithGoogle}>
        <Button type="submit" variant="outline" className="w-full">
          Entrar com Google
        </Button>
      </form>
    </div>
  );
}
