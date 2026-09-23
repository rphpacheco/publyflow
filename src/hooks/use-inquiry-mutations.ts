import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api-client";
import { commercialInquiriesQueryKey, type InquiryStatus } from "./use-commercial-inquiries";

export interface ConvertContactInput {
  id: string;
}

export interface ConvertNewContactInput {
  fullName: string;
  email?: string | null;
  phone?: string | null;
}

export interface ConvertInput {
  inquiryId: string;
  contact: ConvertContactInput | ConvertNewContactInput;
  companyId?: string | null;
  brandId?: string | null;
}

export interface ConvertResult {
  inquiry: unknown;
  lead: unknown;
  opportunity: unknown;
}

export function useConvertInquiry(
  organizationId: string,
  creatorId: string,
  status: InquiryStatus,
): UseMutationResult<ConvertResult, ApiError, ConvertInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ inquiryId, contact, companyId, brandId }) =>
      apiFetch<ConvertResult>(`/api/commercial-inquiries/${inquiryId}/convert`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, contact, companyId, brandId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: commercialInquiriesQueryKey(organizationId, creatorId, status),
      });
    },
  });
}

export function useDiscardInquiry(
  organizationId: string,
  creatorId: string,
  status: InquiryStatus,
): UseMutationResult<void, ApiError, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inquiryId: string) =>
      apiFetch<void>(`/api/commercial-inquiries/${inquiryId}/discard`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: commercialInquiriesQueryKey(organizationId, creatorId, status),
      });
    },
  });
}

export function useMarkFalsePositiveInquiry(
  organizationId: string,
  creatorId: string,
  status: InquiryStatus,
): UseMutationResult<void, ApiError, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inquiryId: string) =>
      apiFetch<void>(`/api/commercial-inquiries/${inquiryId}/mark-false-positive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: commercialInquiriesQueryKey(organizationId, creatorId, status),
      });
    },
  });
}
