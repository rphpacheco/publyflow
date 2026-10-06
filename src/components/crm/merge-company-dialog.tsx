"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { useCompanies, type CompanyDto } from "@/hooks/use-crm";
import { useCompanyMergePreview, useMergeCompany } from "@/hooks/use-crm-merge";
import { ApiError } from "@/lib/api-client";
import { isSameRecordError, MergeWarning, plural, PreviewError } from "./merge-shared";

export function MergeCompanyDialog({
  open,
  company,
  onOpenChange,
  onMerged,
}: {
  open: boolean;
  company: { id: string; name: string };
  onOpenChange: (open: boolean) => void;
  onMerged: (stays: CompanyDto) => void;
}) {
  const { data: companies } = useCompanies();
  const merge = useMergeCompany(company.id);
  const [into, setInto] = React.useState<string | null>(null);
  const [intoError, setIntoError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const preview = useCompanyMergePreview(company.id, into);

  const items = (companies ?? []).filter((item) => item.id !== company.id).map(({ id, name }) => ({ id, name }));
  const previewData = into !== null ? preview.data : undefined;
  const sameRecordFromPreview = isSameRecordError(preview.error) ? preview.error.message : null;
  const canMerge = Boolean(into && previewData) && !merge.isPending;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!into) return;
    setIntoError(null);
    setFormError(null);
    try {
      onMerged(await merge.mutateAsync({ into }));
    } catch (error) {
      if (isSameRecordError(error)) setIntoError(error.message);
      else setFormError(error instanceof ApiError ? error.message : "Não foi possível mesclar. Tente novamente.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="min-w-0 break-words pr-8">
            Mesclar <strong>{company.name}</strong> em:
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <Combobox
              items={items}
              getLabel={(item) => item.name}
              getValue={(item) => item.id}
              value={into}
              onSelect={(item) => {
                setInto(item.id);
                setIntoError(null);
                setFormError(null);
              }}
              placeholder="Selecionar empresa"
              aria-label="Empresa que fica"
              aria-invalid={intoError || sameRecordFromPreview ? true : undefined}
              aria-describedby={intoError || sameRecordFromPreview ? "merge-company-error" : undefined}
            />
            {intoError || sameRecordFromPreview ? <p id="merge-company-error" className="text-xs text-error">{intoError ?? sameRecordFromPreview}</p> : null}
          </div>

          {into !== null && preview.isError && !sameRecordFromPreview ? <PreviewError onRetry={() => void preview.refetch()} /> : null}
          {into !== null && preview.isLoading ? <p className="text-sm text-muted-foreground">Carregando prévia...</p> : null}

          {previewData ? (
            <div className="flex min-w-0 flex-col gap-2 text-sm">
              <p className="break-words">
                Fica: <strong>{previewData.stays.name}</strong>
              </p>
              <p className="break-words">
                Vai mover: {plural(previewData.impact.brands, "brand", "brands")} · {plural(previewData.impact.contacts, "contato", "contatos")} ·{" "}
                {plural(previewData.impact.opportunities, "oportunidade", "oportunidades")}
              </p>
              {previewData.aliasToAdd ? (
                <p className="break-words">
                  &apos;{previewData.aliasToAdd}&apos; passa a ser apelido de &apos;{previewData.stays.name}&apos;
                </p>
              ) : null}
              {previewData.aliasesMoved > 0 ? (
                <p className="break-words">
                  {previewData.aliasesMoved === 1 ? "1 apelido também será movido" : `${previewData.aliasesMoved} apelidos também serão movidos`}
                </p>
              ) : null}
              <MergeWarning>
                Esta ação não pode ser desfeita. <strong>{previewData.duplicate.name}</strong> será excluída.
              </MergeWarning>
            </div>
          ) : null}

          {formError ? (
            <p role="alert" className="text-sm text-error">
              {formError}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={!canMerge}>
              Mesclar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
