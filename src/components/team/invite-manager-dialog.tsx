"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { useInviteManager } from "@/hooks/use-team";

type Field = "fullName" | "email";
type FieldErrors = Partial<Record<Field, string>>;

function toErrors(error: unknown): { fieldErrors: FieldErrors; formError: string | null } {
  if (!(error instanceof ApiError)) {
    return { fieldErrors: {}, formError: "Não foi possível convidar. Tente novamente." };
  }
  if (error.status === 400) {
    const errors = (error.body as { errors?: Partial<Record<Field, string[]>> } | null)?.errors ?? {};
    const result: FieldErrors = {};
    for (const field of ["fullName", "email"] as const) {
      const first = errors[field]?.[0];
      if (first) result[field] = first;
    }
    if (Object.keys(result).length > 0) return { fieldErrors: result, formError: null };
  }
  return { fieldErrors: {}, formError: error.message };
}

export function InviteManagerDialog({
  open,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: (args: { email: string; message: string }) => void;
}) {
  const invite = useInviteManager();
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setErrors({});
      setFormError(null);
    }
    onOpenChange(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setFormError(null);
    try {
      const result = await invite.mutateAsync({ fullName, email });
      setFullName("");
      setEmail("");
      onOpenChange(false);
      onInvited({ email: result.member.email, message: result.message });
    } catch (error) {
      const next = toErrors(error);
      setErrors(next.fieldErrors);
      setFormError(next.formError);
    }
  }

  function field(name: Field, label: string, value: string, onChange: (value: string) => void, extra: React.InputHTMLAttributes<HTMLInputElement>) {
    const errorId = `invite-manager-${name}-error`;
    return (
      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 text-sm">
          {label}
          <Input
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              setErrors(({ [name]: _removed, ...rest }) => rest);
            }}
            aria-invalid={errors[name] ? true : undefined}
            aria-describedby={errors[name] ? errorId : undefined}
            {...extra}
          />
        </label>
        {errors[name] ? (
          <p id={errorId} role="alert" className="text-xs text-error">
            {errors[name]}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar gestor</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex flex-col gap-3">
          {formError ? (
            <p role="alert" className="text-sm text-error [overflow-wrap:anywhere]">
              {formError}
            </p>
          ) : null}
          {field("fullName", "Nome completo", fullName, setFullName, { maxLength: 200, autoComplete: "name" })}
          {field("email", "E-mail", email, setEmail, { type: "email", maxLength: 254, autoComplete: "email" })}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={invite.isPending}>
              Convidar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
