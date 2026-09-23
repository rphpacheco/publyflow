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

export function opportunitiesQueryKey(organizationId: string, creatorId: string) {
  return ["opportunities", organizationId, creatorId] as const;
}

export function useOpportunities(
  organizationId: string,
  creatorId: string,
  options?: { enabled?: boolean },
): UseQueryResult<OpportunityListItem[]> {
  return useQuery({
    queryKey: opportunitiesQueryKey(organizationId, creatorId),
    queryFn: () =>
      apiFetch<OpportunityListItem[]>(
        `/api/opportunities?organizationId=${organizationId}&creatorId=${creatorId}`,
      ),
    enabled: options?.enabled ?? true,
  });
}
