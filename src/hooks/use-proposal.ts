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
import type { ProposalTheme, ProposalStatus } from "@/lib/proposal-themes";
import { proposalSendStateQueryKey } from "./proposal-sending-keys";

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
  theme?: ProposalTheme;
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
      queryClient.invalidateQueries({ queryKey: proposalSendStateQueryKey(proposalId) });
    },
    onError: () => {
      toast.error("Não foi possível salvar. Tente novamente.");
    },
  });
}
