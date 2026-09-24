import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { OpportunityStage } from "@/lib/opportunity-stages";

export interface OpportunityListItem {
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
  companyName: string | null;
  brandName: string | null;
  contactName: string;
}

export function opportunitiesQueryKey(creatorId: string) {
  return ["opportunities", creatorId] as const;
}

export function useOpportunities(
  creatorId: string,
  options?: { enabled?: boolean },
): UseQueryResult<OpportunityListItem[]> {
  return useQuery({
    queryKey: opportunitiesQueryKey(creatorId),
    queryFn: () =>
      apiFetch<OpportunityListItem[]>(`/api/opportunities?creatorId=${creatorId}`),
    enabled: options?.enabled ?? true,
  });
}
