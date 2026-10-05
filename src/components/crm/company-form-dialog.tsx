"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpdateCompany, type CompanyDto } from "@/hooks/use-crm";
import { toFormErrors } from "./form-errors";

export function CompanyFormDialog({
  open,
  company,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  company: { id: string; name: string };
  onOpenChange: (open: boolean) => void;
  onSaved: (company: CompanyDto) => void;
}) {
  const update = useUpdateCompany(company.id);
  const [name, setName] = React.useState(company.name);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setNameError(null);
    setFormError(null);
    try {
      onSaved(await update.mutateAsync({ name }));
    } catch (error) {
      const result = toFormErrors(error, ["name"] as const, "name");
      setNameError(result.fieldErrors.name ?? null);
      setFormError(result.formError);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar empresa</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1 text-sm">
              Nome da empresa
              <Input
                value={name}
                maxLength={200}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameError(null);
                }}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? "company-name-error" : undefined}
              />
            </label>
            {nameError ? (
              <p id="company-name-error" className="text-xs text-error">
                {nameError}
              </p>
            ) : null}
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
