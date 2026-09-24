import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export interface RateCardItemWithService {
  id: string;
  organizationId: string;
  rateCardId: string;
  serviceId: string;
  price: number;
  unitDescription: string | null;
  sortOrder: number;
  createdAt: string;
  serviceName: string;
  rateCardName: string;
}

export function rateCardItemsQueryKey(organizationId: string, creatorId: string) {
  return ["rate-card-items", organizationId, creatorId] as const;
}

export function useRateCardItems(
  organizationId: string,
  creatorId: string,
  options?: { enabled?: boolean },
): UseQueryResult<RateCardItemWithService[]> {
  return useQuery({
    queryKey: rateCardItemsQueryKey(organizationId, creatorId),
    queryFn: () =>
      apiFetch<RateCardItemWithService[]>(
        `/api/rate-card-items?organizationId=${organizationId}&creatorId=${creatorId}`,
      ),
    enabled: options?.enabled ?? true,
  });
}
