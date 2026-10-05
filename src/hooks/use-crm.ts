import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { OpportunityStage } from "@/lib/opportunity-stages";
import type { ProposalStatus } from "@/lib/proposal-themes";

export interface CompanyListItemDto {
  id: string;
  name: string;
  createdAt: string;
  brandCount: number;
  contactCount: number;
  openOpportunityCount: number;
}

export interface ContactListItemDto {
  id: string;
  companyId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  instagramHandle: string | null;
  createdAt: string;
  companyName: string | null;
}

export interface BrandDto {
  id: string;
  name: string;
  companyId: string | null;
}

export interface CrmOpportunityDto {
  id: string;
  brandName: string | null;
  creatorName: string;
  stage: OpportunityStage;
  status: "OPEN" | "WON" | "LOST";
  estimatedValueCents: number | null;
  createdAt: string;
  proposals: Array<{ id: string; title: string; status: ProposalStatus }>;
}

export interface CompanyDto {
  id: string;
  name: string;
  createdAt: string;
}

export interface ContactDto {
  id: string;
  companyId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  instagramHandle: string | null;
  createdAt: string;
}

export interface CompanyDetailDto {
  company: CompanyDto;
  aliases: Array<{ id: string; name: string }>;
  brands: Array<{ id: string; name: string }>;
  contacts: Array<{ id: string; fullName: string; email: string | null; phone: string | null; instagramHandle: string | null }>;
  opportunities: CrmOpportunityDto[];
}

export interface ContactDetailDto {
  contact: ContactDto;
  company: { id: string; name: string } | null;
  opportunities: CrmOpportunityDto[];
}

export interface ContactFormValues {
  fullName: string;
  email: string;
  phone: string;
  instagramHandle: string;
  companyId: string | null;
}

export interface BrandFormValues {
  name: string;
  companyId: string | null;
}

export const crmQueryKey = ["crm"] as const;
// Inbox selectors (use-party-options) read the same lists; renames must show up there too.
export const OPTION_KEYS = [["company-options"], ["brand-options"], ["contact-options"]] as const;

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

function useCrmMutation<TValues, TResult>(url: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: TValues) => apiFetch<TResult>(url, json("PATCH", values)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: crmQueryKey });
      for (const queryKey of OPTION_KEYS) void queryClient.invalidateQueries({ queryKey });
    },
  });
}

export function useCompanies() {
  return useQuery({ queryKey: [...crmQueryKey, "companies"], queryFn: () => apiFetch<CompanyListItemDto[]>("/api/companies") });
}

export function useCompany(companyId: string) {
  return useQuery({ queryKey: [...crmQueryKey, "company", companyId], queryFn: () => apiFetch<CompanyDetailDto>(`/api/companies/${companyId}`) });
}

export function useContacts() {
  return useQuery({ queryKey: [...crmQueryKey, "contacts"], queryFn: () => apiFetch<ContactListItemDto[]>("/api/contacts") });
}

export function useContact(contactId: string) {
  return useQuery({ queryKey: [...crmQueryKey, "contact", contactId], queryFn: () => apiFetch<ContactDetailDto>(`/api/contacts/${contactId}`) });
}

export function useBrands() {
  return useQuery({ queryKey: [...crmQueryKey, "brands"], queryFn: () => apiFetch<BrandDto[]>("/api/brands") });
}

export function useUpdateCompany(companyId: string) {
  return useCrmMutation<{ name: string }, CompanyDto>(`/api/companies/${companyId}`);
}

export function useUpdateContact(contactId: string) {
  return useCrmMutation<ContactFormValues, ContactDto>(`/api/contacts/${contactId}`);
}

export function useUpdateBrand(brandId: string) {
  return useCrmMutation<BrandFormValues, BrandDto>(`/api/brands/${brandId}`);
}
