import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { OpportunityStage } from "@/lib/opportunity-stages";

export interface Opportunity {
  id: string;
  organizationId: string;
  creatorId: string;
  leadId: string;
  companyId: string | null;
  brandId: string | null;
  stage: OpportunityStage;
  status: "OPEN" | "WON" | "LOST";
  estimatedValueCents: number | null;
  createdAt: string;
}

export function opportunityQueryKey(opportunityId: string) {
  return ["opportunity", opportunityId] as const;
}

export function useOpportunity(
  opportunityId: string,
  options?: { enabled?: boolean },
): UseQueryResult<Opportunity> {
  return useQuery({
    queryKey: opportunityQueryKey(opportunityId),
    queryFn: () => apiFetch<Opportunity>(`/api/opportunities/${opportunityId}`),
    enabled: options?.enabled ?? true,
  });
}
