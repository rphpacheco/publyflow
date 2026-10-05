"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpdateContact, type ContactDto, type ContactFormValues } from "@/hooks/use-crm";
import { CompanySelect } from "./company-select";
import { toFormErrors } from "./form-errors";

const FIELDS = ["fullName", "email", "phone", "instagramHandle", "companyId"] as const;
type Field = (typeof FIELDS)[number];

export function ContactFormDialog({
  open,
  contact,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  contact: ContactDto;
  onOpenChange: (open: boolean) => void;
  onSaved: (contact: ContactDto) => void;
}) {
  const update = useUpdateContact(contact.id);
  const [values, setValues] = React.useState<ContactFormValues>({
    fullName: contact.fullName,
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    instagramHandle: contact.instagramHandle ?? "",
    companyId: contact.companyId,
  });
  const [errors, setErrors] = React.useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  function set<K extends Field>(name: K, value: ContactFormValues[K]) {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors(({ [name]: _removed, ...rest }) => rest);
  }

  function textField(name: Exclude<Field, "companyId">, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) {
    const errorId = `contact-${name}-error`;
    return (
      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1 text-sm">
          {label}
          <Input
            value={values[name]}
            maxLength={200}
            onChange={(event) => set(name, event.target.value)}
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
      onSaved(await update.mutateAsync(values));
    } catch (error) {
      const result = toFormErrors(error, FIELDS);
      setErrors(result.fieldErrors);
      setFormError(result.formError);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar contato</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          {textField("fullName", "Nome", { autoComplete: "name" })}
          {textField("email", "E-mail", { type: "email" })}
          {textField("phone", "Telefone", { type: "tel" })}
          {textField("instagramHandle", "@Instagram")}
          <div className="flex flex-col gap-1 text-sm">
            <span>Empresa</span>
            <CompanySelect value={values.companyId} onChange={(companyId) => set("companyId", companyId)} />
            {errors.companyId ? <p className="text-xs text-error">{errors.companyId}</p> : null}
          </div>
          {formError ? (
            <p role="alert" className="text-sm text-error">
              {formError}
            </p>
          ) : null}
          <Button type="submit" disabled={update.isPending}>
            Salvar
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
