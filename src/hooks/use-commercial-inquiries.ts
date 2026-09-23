import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export type InquiryStatus = "NEW" | "DISCARDED" | "FALSE_POSITIVE" | "CONVERTED";

export interface CommercialInquiryListItem {
  id: string;
  organizationId: string;
  creatorId: string;
  messageId: string;
  status: InquiryStatus;
  companyGuess: string | null;
  brandGuess: string | null;
  contactNameGuess: string | null;
  budgetGuess: string | null;
  intentGuess: string | null;
  convertedLeadId: string | null;
  linkedOpportunityId: string | null;
  createdAt: string;
  messageBody: string;
  messageReceivedAt: string;
  externalContactLabel: string;
  source: "INSTAGRAM" | "WHATSAPP" | "TIKTOK";
  conversationId: string;
}

export function commercialInquiriesQueryKey(
  organizationId: string,
  creatorId: string,
  status: InquiryStatus,
) {
  return ["commercial-inquiries", organizationId, creatorId, status] as const;
}

export function useCommercialInquiries(
  organizationId: string,
  creatorId: string,
  status: InquiryStatus,
  options?: { enabled?: boolean },
): UseQueryResult<CommercialInquiryListItem[]> {
  return useQuery({
    queryKey: commercialInquiriesQueryKey(organizationId, creatorId, status),
    queryFn: () =>
      apiFetch<CommercialInquiryListItem[]>(
        `/api/commercial-inquiries?organizationId=${organizationId}&creatorId=${creatorId}&status=${status}`,
      ),
    enabled: options?.enabled ?? true,
  });
}
