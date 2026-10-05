"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { useContacts, type ContactDto } from "@/hooks/use-crm";
import { useContactMergePreview, useMergeContact, type ContactMergeField } from "@/hooks/use-crm-merge";
import { ApiError } from "@/lib/api-client";
import { isSameRecordError, MergeWarning, plural, PreviewError } from "./merge-shared";

export function MergeContactDialog({
  open,
  contact,
  onOpenChange,
  onMerged,
}: {
  open: boolean;
  contact: { id: string; fullName: string };
  onOpenChange: (open: boolean) => void;
  onMerged: (stays: ContactDto) => void;
}) {
  const { data: contacts } = useContacts();
  const merge = useMergeContact(contact.id);
  const [into, setInto] = React.useState<string | null>(null);
  const [intoError, setIntoError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const preview = useContactMergePreview(contact.id, into);

  const items = (contacts ?? [])
    .filter((item) => item.id !== contact.id)
    .map((item) => ({ id: item.id, label: item.companyName ? `${item.fullName} (${item.companyName})` : item.fullName }));
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

  const fields: Array<{ label: string; value: string | null; field: ContactMergeField | null }> = previewData
    ? [
        { label: "Nome", value: previewData.result.fullName, field: null },
        { label: "E-mail", value: previewData.result.email, field: "email" },
        { label: "Telefone", value: previewData.result.phone, field: "phone" },
        { label: "Instagram", value: previewData.result.instagramHandle, field: "instagramHandle" },
        { label: "Empresa", value: previewData.result.company?.name ?? null, field: "companyId" },
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="min-w-0 break-words pr-8">
            Mesclar <strong>{contact.fullName}</strong> em:
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <Combobox
              items={items}
              getLabel={(item) => item.label}
              getValue={(item) => item.id}
              value={into}
              onSelect={(item) => {
                setInto(item.id);
                setIntoError(null);
                setFormError(null);
              }}
              placeholder="Selecionar contato"
              aria-label="Contato que fica"
              aria-invalid={intoError || sameRecordFromPreview ? true : undefined}
            />
            {intoError || sameRecordFromPreview ? <p className="text-xs text-error">{intoError ?? sameRecordFromPreview}</p> : null}
          </div>

          {into !== null && preview.isError && !sameRecordFromPreview ? <PreviewError onRetry={() => void preview.refetch()} /> : null}
          {into !== null && preview.isLoading ? <p className="text-sm text-muted-foreground">Carregando prévia...</p> : null}

          {previewData ? (
            <div className="flex min-w-0 flex-col gap-2 text-sm">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
                {fields.map(({ label, value, field }) => (
                  <React.Fragment key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 break-words">
                      {value ?? "—"}
                      {field && previewData.filledFromDuplicate.includes(field) ? " (do duplicado)" : ""}
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
              <p className="break-words">Vai mover: {plural(previewData.impact.leads, "lead", "leads")}</p>
              <MergeWarning>
                Esta ação não pode ser desfeita. <strong>{previewData.duplicate.name}</strong> será excluído.
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
