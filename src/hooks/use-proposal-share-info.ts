import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export interface ShareInfoDto {
  proposalTitle: string;
  creatorName: string;
  contact: { name: string; phone: string | null; email: string | null } | null;
}

export function useProposalShareInfo(proposalId: string) {
  return useQuery({
    queryKey: ["proposal-share-info", proposalId],
    queryFn: () => apiFetch<ShareInfoDto>(`/api/proposals/${proposalId}/share-info`),
  });
}
