"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { useCompanyOptions, useContactOptions, type PartyOption } from "@/hooks/use-party-options";

export interface InquiryEditFormProps {
  organizationId: string;
  initialCompanyName: string | null;
  initialContactName: string | null;
  onConfirm: (input: { contact: { id: string } | { fullName: string }; companyId?: string | null }) => void;
}

export function InquiryEditForm({
  organizationId,
  initialCompanyName,
  initialContactName,
  onConfirm,
}: InquiryEditFormProps) {
  const { data: companyOptions = [] } = useCompanyOptions(organizationId);
  const { data: contactOptions = [] } = useContactOptions(organizationId);

  const [selectedCompany, setSelectedCompany] = React.useState<PartyOption | null>(null);
  const [newCompanyName, setNewCompanyName] = React.useState<string | null>(null);
  const [selectedContact, setSelectedContact] = React.useState<PartyOption | null>(null);
  const [newContactName, setNewContactName] = React.useState<string | null>(initialContactName);

  function handleConfirm() {
    const contact = selectedContact
      ? { id: selectedContact.id }
      : { fullName: newContactName ?? initialContactName ?? "Desconhecido" };

    onConfirm({
      contact,
      companyId: selectedCompany ? selectedCompany.id : newCompanyName ? undefined : null,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="edit-company">
          Empresa
        </label>
        <Combobox<PartyOption>
          items={companyOptions}
          getLabel={(item) => item.label}
          getValue={(item) => item.id}
          value={selectedCompany?.id ?? null}
          onSelect={(item) => {
            setSelectedCompany(item);
            setNewCompanyName(null);
          }}
          onCreateNew={(name) => {
            setSelectedCompany(null);
            setNewCompanyName(name);
          }}
          placeholder={initialCompanyName ?? "Selecionar empresa..."}
          aria-label="Empresa"
        />
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

      <Button onClick={handleConfirm}>Confirmar</Button>
    </div>
  );
}
