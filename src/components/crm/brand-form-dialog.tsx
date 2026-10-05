"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpdateBrand, type BrandDto, type BrandFormValues } from "@/hooks/use-crm";
import { CompanySelect } from "./company-select";
import { toFormErrors } from "./form-errors";

const FIELDS = ["name", "companyId"] as const;
type Field = (typeof FIELDS)[number];

export function BrandFormDialog({
  open,
  brand,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  brand: { id: string; name: string; companyId: string | null };
  onOpenChange: (open: boolean) => void;
  onSaved: (brand: BrandDto) => void;
}) {
  const update = useUpdateBrand(brand.id);
  const [values, setValues] = React.useState<BrandFormValues>({
    name: brand.name,
    companyId: brand.companyId,
  });
  const [errors, setErrors] = React.useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  function set<K extends Field>(name: K, value: BrandFormValues[K]) {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors(({ [name]: _removed, ...rest }) => rest);
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
          <DialogTitle>Editar brand</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="flex flex-col gap-1 text-sm">
              Nome da brand
              <Input
                value={values.name}
                maxLength={200}
                onChange={(event) => set("name", event.target.value)}
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? "brand-name-error" : undefined}
              />
            </label>
            {errors.name ? (
              <p id="brand-name-error" className="text-xs text-error">
                {errors.name}
              </p>
            ) : null}
          </div>
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
