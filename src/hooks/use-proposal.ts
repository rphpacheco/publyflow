import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/api-client";
import type { Proposal } from "./use-proposals";
import type { ProposalTemplate, ProposalStatus } from "@/lib/proposal-templates";

export function proposalQueryKey(proposalId: string) {
  return ["proposal", proposalId] as const;
}

export function useProposal(
  proposalId: string,
  options?: { enabled?: boolean },
): UseQueryResult<Proposal> {
  return useQuery({
    queryKey: proposalQueryKey(proposalId),
    queryFn: () => apiFetch<Proposal>(`/api/proposals/${proposalId}`),
    enabled: options?.enabled ?? true,
  });
}

export interface UpdateProposalInput {
  title?: string;
  template?: ProposalTemplate;
  status?: ProposalStatus;
}

export function useUpdateProposal(
  proposalId: string,
): UseMutationResult<Proposal, ApiError, UpdateProposalInput> {
  const queryClient = useQueryClient();
  const queryKey = proposalQueryKey(proposalId);

  return useMutation({
    mutationFn: (input) =>
      apiFetch<Proposal>(`/api/proposals/${proposalId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
    },
    onError: () => {
      toast.error("Não foi possível salvar. Tente novamente.");
    },
  });
}
