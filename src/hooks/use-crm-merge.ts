import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { crmQueryKey, OPTION_KEYS, type CompanyDto, type ContactDto } from "@/hooks/use-crm";

export interface CompanyMergePreviewDto {
  duplicate: { id: string; name: string };
  stays: { id: string; name: string };
  result: { name: string };
  impact: { brands: number; contacts: number; leads: number; opportunities: number };
  aliasToAdd: string | null;
  aliasesMoved: number;
}

export type ContactMergeField = "email" | "phone" | "instagramHandle" | "companyId";

export interface ContactMergePreviewDto {
  duplicate: { id: string; name: string };
  stays: { id: string; name: string };
  result: {
    fullName: string;
    email: string | null;
    phone: string | null;
    instagramHandle: string | null;
    company: { id: string; name: string } | null;
  };
  filledFromDuplicate: ContactMergeField[];
  impact: { leads: number };
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

function useInvalidateCrm() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: crmQueryKey });
    for (const queryKey of OPTION_KEYS) void queryClient.invalidateQueries({ queryKey });
  };
}

export function useCompanyMergePreview(duplicateId: string, into: string | null) {
  return useQuery({
    queryKey: [...crmQueryKey, "merge-preview", "company", duplicateId, into],
    queryFn: () => apiFetch<CompanyMergePreviewDto>(`/api/companies/${duplicateId}/merge-preview?into=${encodeURIComponent(into ?? "")}`),
    enabled: into !== null,
    retry: false,
  });
}

export function useContactMergePreview(duplicateId: string, into: string | null) {
  return useQuery({
    queryKey: [...crmQueryKey, "merge-preview", "contact", duplicateId, into],
    queryFn: () => apiFetch<ContactMergePreviewDto>(`/api/contacts/${duplicateId}/merge-preview?into=${encodeURIComponent(into ?? "")}`),
    enabled: into !== null,
    retry: false,
  });
}

export function useMergeCompany(duplicateId: string) {
  const invalidate = useInvalidateCrm();
  return useMutation({
    mutationFn: (values: { into: string }) => apiFetch<CompanyDto>(`/api/companies/${duplicateId}/merge`, post(values)),
    onSettled: invalidate,
  });
}

export function useMergeContact(duplicateId: string) {
  const invalidate = useInvalidateCrm();
  return useMutation({
    mutationFn: (values: { into: string }) => apiFetch<ContactDto>(`/api/contacts/${duplicateId}/merge`, post(values)),
    onSettled: invalidate,
  });
}

// apiFetch returns undefined for a 204, so it is safe for the alias DELETE.
export function useRemoveCompanyAlias(companyId: string) {
  const invalidate = useInvalidateCrm();
  return useMutation({
    mutationFn: ({ aliasId }: { aliasId: string }) =>
      apiFetch<void>(`/api/companies/${companyId}/aliases/${aliasId}`, { method: "DELETE" }),
    onSettled: invalidate,
  });
}
