"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  useBrandOptions,
  useCompanyOptions,
  useContactOptions,
  type PartyOption,
} from "@/hooks/use-party-options";

export interface InquiryEditFormProps {
  organizationId: string;
  initialCompanyName: string | null;
  initialContactName: string | null;
  onConfirm: (input: {
    contact: { id: string } | { fullName: string };
    companyId: string | null;
    brandId: string | null;
  }) => void;
}

type PartyResolution = { type: "selected"; id: string } | { type: "none" };

export function InquiryEditForm({
  organizationId,
  initialCompanyName,
  initialContactName,
  onConfirm,
}: InquiryEditFormProps) {
  const { data: companyOptions = [] } = useCompanyOptions(organizationId);
  const { data: brandOptions = [] } = useBrandOptions(organizationId);
  const { data: contactOptions = [] } = useContactOptions(organizationId);

  const [companyResolution, setCompanyResolution] = React.useState<PartyResolution | null>(null);
  const [brandResolution, setBrandResolution] = React.useState<PartyResolution | null>(null);
  const [selectedContact, setSelectedContact] = React.useState<PartyOption | null>(null);
  const [newContactName, setNewContactName] = React.useState<string | null>(initialContactName);

  const selectedCompany =
    companyResolution?.type === "selected"
      ? (companyOptions.find((item) => item.id === companyResolution.id) ?? null)
      : null;
  const selectedBrand =
    brandResolution?.type === "selected"
      ? (brandOptions.find((item) => item.id === brandResolution.id) ?? null)
      : null;

  const canConfirm = companyResolution !== null && brandResolution !== null;

  function handleConfirm() {
    if (!canConfirm) return;

    const contact = selectedContact
      ? { id: selectedContact.id }
      : { fullName: newContactName ?? initialContactName ?? "Desconhecido" };

    onConfirm({
      contact,
      companyId: companyResolution!.type === "selected" ? companyResolution!.id : null,
      brandId: brandResolution!.type === "selected" ? brandResolution!.id : null,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="edit-company">
          Empresa
        </label>
        {initialCompanyName ? (
          <p className="text-xs text-muted-foreground">A IA sugeriu: {initialCompanyName}</p>
        ) : null}
        <div className="flex items-center gap-2">
          <Combobox<PartyOption>
            items={companyOptions}
            getLabel={(item) => item.label}
            getValue={(item) => item.id}
            value={selectedCompany?.id ?? null}
            onSelect={(item) => setCompanyResolution({ type: "selected", id: item.id })}
            placeholder="Buscar empresa..."
            aria-label="Empresa"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCompanyResolution({ type: "none" })}
          >
            Sem empresa
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="edit-brand">
          Marca
        </label>
        <div className="flex items-center gap-2">
          <Combobox<PartyOption>
            items={brandOptions}
            getLabel={(item) => item.label}
            getValue={(item) => item.id}
            value={selectedBrand?.id ?? null}
            onSelect={(item) => setBrandResolution({ type: "selected", id: item.id })}
            placeholder="Buscar marca..."
            aria-label="Marca"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setBrandResolution({ type: "none" })}
          >
            Sem marca
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="edit-contact">
          Contato
        </label>
        <Combobox<PartyOption>
          items={contactOptions}
          getLabel={(item) => item.label}
          getValue={(item) => item.id}
          value={selectedContact?.id ?? null}
          onSelect={(item) => {
            setSelectedContact(item);
            setNewContactName(null);
          }}
          onCreateNew={(name) => {
            setSelectedContact(null);
            setNewContactName(name);
          }}
          placeholder={initialContactName ?? "Selecionar contato..."}
          aria-label="Contato"
        />
      </div>

      <Button onClick={handleConfirm} disabled={!canConfirm}>
        Confirmar
      </Button>
    </div>
  );
}
