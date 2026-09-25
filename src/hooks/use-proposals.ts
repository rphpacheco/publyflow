import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/api-client";
import type { ProposalTheme, ProposalStatus } from "@/lib/proposal-themes";

export interface Proposal {
  id: string;
  organizationId: string;
  opportunityId: string;
  title: string;
  theme: ProposalTheme;
  status: ProposalStatus;
  createdAt: string;
}

export function proposalsQueryKey(opportunityId: string) {
  return ["proposals", opportunityId] as const;
}

export function useProposals(
  opportunityId: string,
  options?: { enabled?: boolean },
): UseQueryResult<Proposal[]> {
  return useQuery({
    queryKey: proposalsQueryKey(opportunityId),
    queryFn: () =>
      apiFetch<Proposal[]>(`/api/proposals?opportunityId=${opportunityId}`),
    enabled: options?.enabled ?? true,
  });
}

export interface CreateProposalInput {
  opportunityId: string;
  title: string;
  theme: ProposalTheme;
}

export function useCreateProposal(): UseMutationResult<Proposal, ApiError, CreateProposalInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<Proposal>("/api/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          opportunityId: input.opportunityId,
          title: input.title,
          theme: input.theme,
        }),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: proposalsQueryKey(variables.opportunityId),
      });
    },
    onError: () => {
      toast.error("Não foi possível criar a proposta. Tente novamente.");
    },
  });
}
