"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { useCreateCreator, useUpdateCreator, type CreatorDto } from "@/hooks/use-creators";

type Field = "fullName" | "displayName" | "instagramHandle" | "email";
type FieldErrors = Partial<Record<Field, string>>;

interface SubmitError {
  fieldErrors: FieldErrors;
  formError: string | null;
}

function toFieldErrors(error: unknown): SubmitError {
  if (!(error instanceof ApiError)) {
    return { fieldErrors: {}, formError: "Não foi possível salvar. Tente novamente." };
  }
  if (error.status === 409) {
    return { fieldErrors: { email: error.message }, formError: null };
  }
  const errors = (error.body as { errors?: Partial<Record<Field, string[]>> } | null)?.errors ?? {};
  const result: FieldErrors = {};
  for (const field of ["fullName", "displayName", "instagramHandle", "email"] as const) {
    const first = errors[field]?.[0];
    if (first) result[field] = first;
  }
  if (Object.keys(result).length > 0) return { fieldErrors: result, formError: null };
  return { fieldErrors: {}, formError: error.message };
}

export function CreatorFormDialog({
  open,
  creator,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  creator: CreatorDto | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (creator: CreatorDto, mode: "create" | "edit") => void;
}) {
  const editing = creator !== null;
  const create = useCreateCreator();
  const update = useUpdateCreator(creator?.id ?? "");
  const [fullName, setFullName] = React.useState("");
  const [displayName, setDisplayName] = React.useState(creator?.displayName ?? "");
  const [displayNameTouched, setDisplayNameTouched] = React.useState(editing);
  const [instagramHandle, setInstagramHandle] = React.useState(creator?.instagramHandle ?? "");
  const [email, setEmail] = React.useState(creator?.email ?? "");
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  function field(
    name: Field,
    label: string,
    value: string,
    onChange: (value: string) => void,
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) {
    const errorId = `creator-${name}-error`;
    return (
      <div className="flex flex-col gap-1" key={name}>
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
          <p id={errorId} className="text-xs text-error">
            {errors[name]}
          </p>
        ) : null}
      </div>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setFormError(null);
    try {
      const saved = editing
        ? await update.mutateAsync({ displayName, instagramHandle })
        : await create.mutateAsync({ fullName, displayName, instagramHandle, email });
      onSaved(saved, editing ? "edit" : "create");
    } catch (error) {
      const { fieldErrors, formError: nextFormError } = toFieldErrors(error);
      setErrors(fieldErrors);
      setFormError(nextFormError);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar creator" : "Novo creator"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          {editing
            ? null
            : field(
                "fullName",
                "Nome completo",
                fullName,
                (value) => {
                  setFullName(value);
                  if (!displayNameTouched) setDisplayName(value);
                },
                { maxLength: 120, autoComplete: "name" },
              )}
          {field(
            "displayName",
            "Nome de exibição",
            displayName,
            (value) => {
              setDisplayName(value);
              setDisplayNameTouched(true);
            },
            { maxLength: 80 },
          )}
          {field("instagramHandle", "@Instagram", instagramHandle, setInstagramHandle, { maxLength: 31 })}
          {field("email", "E-mail", email, setEmail, { type: "email", maxLength: 254, disabled: editing })}
          {formError ? (
            <p role="alert" className="text-sm text-error">
              {formError}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            {editing ? "Salvar" : "Cadastrar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
