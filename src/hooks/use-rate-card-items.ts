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

export function rateCardItemsQueryKey(creatorId: string) {
  return ["rate-card-items", creatorId] as const;
}

export function useRateCardItems(
  creatorId: string,
  options?: { enabled?: boolean },
): UseQueryResult<RateCardItemWithService[]> {
  return useQuery({
    queryKey: rateCardItemsQueryKey(creatorId),
    queryFn: () =>
      apiFetch<RateCardItemWithService[]>(`/api/rate-card-items?creatorId=${creatorId}`),
    enabled: options?.enabled ?? true,
  });
}
