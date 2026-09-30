import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api-client";
import {
  commercialInquiriesQueryKey,
  type CommercialInquiryListItem,
  type InquiryStatus,
} from "./use-commercial-inquiries";

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
  creatorId: string,
  status: InquiryStatus,
): UseMutationResult<ConvertResult, ApiError, ConvertInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ inquiryId, contact, companyId, brandId }) =>
      apiFetch<ConvertResult>(`/api/commercial-inquiries/${inquiryId}/convert`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contact, companyId, brandId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: commercialInquiriesQueryKey(creatorId, status),
      });
    },
  });
}

export interface UpdateInquiryGuessesInput {
  inquiryId: string;
  contactName?: string | null;
  companyName?: string | null;
  brandName?: string | null;
}

// F3: the PATCH route (src/app/api/commercial-inquiries/[id]/route.ts)
// returns the raw `commercial_inquiries` row from
// CommercialInquiryService.updateGuesses, not a full
// CommercialInquiryListItem (which also carries join-derived fields like
// `messageBody`/`externalContactLabel` that the row alone doesn't have).
export type UpdateInquiryGuessesResult = Pick<
  CommercialInquiryListItem,
  "id" | "status" | "contactNameGuess" | "companyGuess" | "brandGuess"
>;

export function useUpdateInquiryGuesses(
  creatorId: string,
  status: InquiryStatus,
): UseMutationResult<UpdateInquiryGuessesResult, ApiError, UpdateInquiryGuessesInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ inquiryId, ...fields }) =>
      apiFetch<UpdateInquiryGuessesResult>(`/api/commercial-inquiries/${inquiryId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fields),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commercialInquiriesQueryKey(creatorId, status) });
    },
  });
}

export function useDiscardInquiry(
  creatorId: string,
  status: InquiryStatus,
): UseMutationResult<void, ApiError, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inquiryId: string) =>
      apiFetch<void>(`/api/commercial-inquiries/${inquiryId}/discard`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: commercialInquiriesQueryKey(creatorId, status),
      });
    },
  });
}

export function useMarkFalsePositiveInquiry(
  creatorId: string,
  status: InquiryStatus,
): UseMutationResult<void, ApiError, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inquiryId: string) =>
      apiFetch<void>(`/api/commercial-inquiries/${inquiryId}/mark-false-positive`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: commercialInquiriesQueryKey(creatorId, status),
      });
    },
  });
}
