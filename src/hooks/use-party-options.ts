import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export interface PartyOption {
  id: string;
  label: string;
}

export function useCompanyOptions(): UseQueryResult<PartyOption[]> {
  return useQuery({
    queryKey: ["company-options"],
    queryFn: async () => {
      const companies = await apiFetch<{ id: string; name: string }[]>(`/api/companies`);
      return companies.map((company) => ({ id: company.id, label: company.name }));
    },
  });
}

export function useBrandOptions(): UseQueryResult<PartyOption[]> {
  return useQuery({
    queryKey: ["brand-options"],
    queryFn: async () => {
      const brands = await apiFetch<{ id: string; name: string }[]>(`/api/brands`);
      return brands.map((brand) => ({ id: brand.id, label: brand.name }));
    },
  });
}

export function useContactOptions(): UseQueryResult<PartyOption[]> {
  return useQuery({
    queryKey: ["contact-options"],
    queryFn: async () => {
      const contacts = await apiFetch<{ id: string; fullName: string }[]>(`/api/contacts`);
      return contacts.map((contact) => ({ id: contact.id, label: contact.fullName }));
    },
  });
}
