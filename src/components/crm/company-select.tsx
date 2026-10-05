"use client";

import { Combobox } from "@/components/ui/combobox";
import { useCompanies } from "@/hooks/use-crm";

const NONE = { id: "", name: "Sem empresa" };

export function CompanySelect({ value, onChange }: { value: string | null; onChange: (companyId: string | null) => void }) {
  const { data } = useCompanies();
  const items = [NONE, ...(data ?? []).map(({ id, name }) => ({ id, name }))];
  return (
    <Combobox
      items={items}
      getLabel={(item) => item.name}
      getValue={(item) => item.id}
      value={value ?? ""}
      onSelect={(item) => onChange(item.id || null)}
      placeholder="Selecionar empresa"
      aria-label="Empresa"
    />
  );
}
