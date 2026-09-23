import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export interface PartyOption {
  id: string;
  label: string;
}

export function useCompanyOptions(organizationId: string): UseQueryResult<PartyOption[]> {
  return useQuery({
    queryKey: ["company-options", organizationId],
    queryFn: async () => {
      const companies = await apiFetch<{ id: string; name: string }[]>(
        `/api/companies?organizationId=${organizationId}`,
      );
      return companies.map((company) => ({ id: company.id, label: company.name }));
    },
  });
}

export function useBrandOptions(organizationId: string): UseQueryResult<PartyOption[]> {
  return useQuery({
    queryKey: ["brand-options", organizationId],
    queryFn: async () => {
      const brands = await apiFetch<{ id: string; name: string }[]>(
        `/api/brands?organizationId=${organizationId}`,
      );
      return brands.map((brand) => ({ id: brand.id, label: brand.name }));
    },
  });
}

export function useContactOptions(organizationId: string): UseQueryResult<PartyOption[]> {
  return useQuery({
    queryKey: ["contact-options", organizationId],
    queryFn: async () => {
      const contacts = await apiFetch<{ id: string; fullName: string }[]>(
        `/api/contacts?organizationId=${organizationId}`,
      );
      return contacts.map((contact) => ({ id: contact.id, label: contact.fullName }));
    },
  });
}
