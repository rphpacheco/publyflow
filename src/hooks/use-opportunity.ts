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

export function opportunityQueryKey(organizationId: string, opportunityId: string) {
  return ["opportunity", organizationId, opportunityId] as const;
}

export function useOpportunity(
  organizationId: string,
  opportunityId: string,
  options?: { enabled?: boolean },
): UseQueryResult<Opportunity> {
  return useQuery({
    queryKey: opportunityQueryKey(organizationId, opportunityId),
    queryFn: () =>
      apiFetch<Opportunity>(`/api/opportunities/${opportunityId}?organizationId=${organizationId}`),
    enabled: options?.enabled ?? true,
  });
}
