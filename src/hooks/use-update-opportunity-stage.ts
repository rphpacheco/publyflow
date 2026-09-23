import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/api-client";
import { opportunitiesQueryKey, type OpportunityListItem } from "./use-opportunities";
import type { OpportunityStage } from "@/lib/opportunity-stages";

export interface UpdateStageInput {
  opportunityId: string;
  stage: OpportunityStage;
}

interface MutationContext {
  previous?: OpportunityListItem[];
}

export function useUpdateOpportunityStage(
  organizationId: string,
  creatorId: string,
): UseMutationResult<unknown, ApiError, UpdateStageInput, MutationContext> {
  const queryClient = useQueryClient();
  const queryKey = opportunitiesQueryKey(organizationId, creatorId);

  return useMutation({
    mutationFn: ({ opportunityId, stage }) =>
      apiFetch(`/api/opportunities/${opportunityId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, stage }),
      }),
    onMutate: async ({ opportunityId, stage }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<OpportunityListItem[]>(queryKey);
      queryClient.setQueryData<OpportunityListItem[]>(queryKey, (old) =>
        old?.map((item) => (item.id === opportunityId ? { ...item, stage } : item)) ?? old,
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      toast.error("Não foi possível mover a oportunidade. Tente novamente.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}
