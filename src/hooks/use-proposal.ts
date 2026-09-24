import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api-client";
import type { Proposal } from "./use-proposals";
import type { ProposalTemplate, ProposalStatus } from "@/lib/proposal-templates";

export function proposalQueryKey(organizationId: string, proposalId: string) {
  return ["proposal", organizationId, proposalId] as const;
}

export function useProposal(
  organizationId: string,
  proposalId: string,
  options?: { enabled?: boolean },
): UseQueryResult<Proposal> {
  return useQuery({
    queryKey: proposalQueryKey(organizationId, proposalId),
    queryFn: () => apiFetch<Proposal>(`/api/proposals/${proposalId}?organizationId=${organizationId}`),
    enabled: options?.enabled ?? true,
  });
}

export interface UpdateProposalInput {
  title?: string;
  template?: ProposalTemplate;
  status?: ProposalStatus;
}

export function useUpdateProposal(
  organizationId: string,
  proposalId: string,
  userId: string,
): UseMutationResult<Proposal, ApiError, UpdateProposalInput> {
  const queryClient = useQueryClient();
  const queryKey = proposalQueryKey(organizationId, proposalId);

  return useMutation({
    mutationFn: (input) =>
      apiFetch<Proposal>(`/api/proposals/${proposalId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, userId, ...input }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
    },
  });
}
