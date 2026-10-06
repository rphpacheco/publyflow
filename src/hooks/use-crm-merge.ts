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
  return (options?: { refetchType: "none" }) => {
    void queryClient.invalidateQueries({ queryKey: crmQueryKey, ...options });
    for (const queryKey of OPTION_KEYS) void queryClient.invalidateQueries({ queryKey, ...options });
  };
}

// The merged-away record no longer exists: drop its detail and preview queries
// and only mark everything else stale, so the still-mounted page of the deleted
// record does not refetch (and 404) before navigation.
function useSettleMerge(kind: "company" | "contact", duplicateId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateCrm();
  return {
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: [...crmQueryKey, "merge-preview", kind, duplicateId] });
      queryClient.removeQueries({ queryKey: [...crmQueryKey, kind, duplicateId] });
      invalidate({ refetchType: "none" });
    },
    onError: () => invalidate(),
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
  const settle = useSettleMerge("company", duplicateId);
  return useMutation({
    mutationFn: (values: { into: string }) => apiFetch<CompanyDto>(`/api/companies/${duplicateId}/merge`, post(values)),
    ...settle,
  });
}

export function useMergeContact(duplicateId: string) {
  const settle = useSettleMerge("contact", duplicateId);
  return useMutation({
    mutationFn: (values: { into: string }) => apiFetch<ContactDto>(`/api/contacts/${duplicateId}/merge`, post(values)),
    ...settle,
  });
}

// apiFetch returns undefined for a 204, so it is safe for the alias DELETE.
export function useRemoveCompanyAlias(companyId: string) {
  const invalidate = useInvalidateCrm();
  return useMutation({
    mutationFn: ({ aliasId }: { aliasId: string }) =>
      apiFetch<void>(`/api/companies/${companyId}/aliases/${aliasId}`, { method: "DELETE" }),
    onSettled: () => invalidate(),
  });
}
