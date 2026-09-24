import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/api-client";

export interface ProposalItem {
  id: string;
  organizationId: string;
  proposalId: string;
  rateCardItemId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  sortOrder: number;
  createdAt: string;
}

export function proposalItemsQueryKey(proposalId: string) {
  return ["proposal-items", proposalId] as const;
}

export function useProposalItems(
  proposalId: string,
  options?: { enabled?: boolean },
): UseQueryResult<ProposalItem[]> {
  return useQuery({
    queryKey: proposalItemsQueryKey(proposalId),
    queryFn: () => apiFetch<ProposalItem[]>(`/api/proposals/${proposalId}/items`),
    enabled: options?.enabled ?? true,
  });
}

export type AddProposalItemInput =
  | { rateCardItemId: string }
  | { description: string; unitPrice: number };

export function useAddProposalItem(
  proposalId: string,
): UseMutationResult<ProposalItem, ApiError, AddProposalItemInput> {
  const queryClient = useQueryClient();
  const queryKey = proposalItemsQueryKey(proposalId);

  return useMutation({
    mutationFn: (input) =>
      apiFetch<ProposalItem>(`/api/proposals/${proposalId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: () => {
      toast.error("Não foi possível adicionar o item. Tente novamente.");
    },
  });
}

export interface UpdateProposalItemInput {
  itemId: string;
  description?: string;
  unitPrice?: number;
  quantity?: number;
}

export function useUpdateProposalItem(
  proposalId: string,
): UseMutationResult<ProposalItem, ApiError, UpdateProposalItemInput> {
  const queryClient = useQueryClient();
  const queryKey = proposalItemsQueryKey(proposalId);

  return useMutation({
    mutationFn: ({ itemId, ...input }) =>
      apiFetch<ProposalItem>(`/api/proposal-items/${itemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposalId, ...input }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData<ProposalItem[]>(queryKey, (old) =>
        old?.map((item) => (item.id === data.id ? data : item)) ?? old,
      );
    },
    onError: () => {
      toast.error("Não foi possível salvar. Tente novamente.");
    },
  });
}

export function useRemoveProposalItem(
  proposalId: string,
): UseMutationResult<void, ApiError, string> {
  const queryClient = useQueryClient();
  const queryKey = proposalItemsQueryKey(proposalId);

  return useMutation({
    mutationFn: (itemId) =>
      apiFetch<void>(`/api/proposal-items/${itemId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposalId }),
      }),
    onSuccess: (_data, itemId) => {
      queryClient.setQueryData<ProposalItem[]>(queryKey, (old) => old?.filter((item) => item.id !== itemId) ?? old);
    },
    onError: () => {
      toast.error("Não foi possível remover o item. Tente novamente.");
    },
  });
}
