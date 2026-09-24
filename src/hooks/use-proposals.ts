import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api-client";
import type { ProposalTemplate, ProposalStatus } from "@/lib/proposal-templates";

export interface Proposal {
  id: string;
  organizationId: string;
  opportunityId: string;
  title: string;
  template: ProposalTemplate;
  status: ProposalStatus;
  createdAt: string;
}

export function proposalsQueryKey(organizationId: string, opportunityId: string) {
  return ["proposals", organizationId, opportunityId] as const;
}

export function useProposals(
  organizationId: string,
  opportunityId: string,
  options?: { enabled?: boolean },
): UseQueryResult<Proposal[]> {
  return useQuery({
    queryKey: proposalsQueryKey(organizationId, opportunityId),
    queryFn: () =>
      apiFetch<Proposal[]>(
        `/api/proposals?organizationId=${organizationId}&opportunityId=${opportunityId}`,
      ),
    enabled: options?.enabled ?? true,
  });
}

export interface CreateProposalInput {
  opportunityId: string;
  title: string;
  template: ProposalTemplate;
}

export function useCreateProposal(
  organizationId: string,
  userId: string,
): UseMutationResult<Proposal, ApiError, CreateProposalInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<Proposal>("/api/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          opportunityId: input.opportunityId,
          title: input.title,
          template: input.template,
          userId,
        }),
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: proposalsQueryKey(organizationId, variables.opportunityId),
      });
    },
  });
}
