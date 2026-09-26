import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/api-client";
import { proposalSendStateQueryKey } from "./proposal-sending-keys";

export type ProposalBlockType =
  | "COVER"
  | "TEXT"
  | "IMAGE"
  | "METRICS"
  | "SERVICES"
  | "PRICING"
  | "TIMELINE"
  | "GALLERY"
  | "TESTIMONIALS"
  | "SOCIAL_LINKS"
  | "FOOTER";

export interface ProposalBlock {
  id: string;
  organizationId: string;
  proposalId: string;
  blockType: ProposalBlockType;
  content: unknown;
  sortOrder: number;
  createdAt: string;
}

export function proposalBlocksQueryKey(proposalId: string) {
  return ["proposal-blocks", proposalId] as const;
}

export function useProposalBlocks(
  proposalId: string,
  options?: { enabled?: boolean },
): UseQueryResult<ProposalBlock[]> {
  return useQuery({
    queryKey: proposalBlocksQueryKey(proposalId),
    queryFn: () => apiFetch<ProposalBlock[]>(`/api/proposals/${proposalId}/blocks`),
    enabled: options?.enabled ?? true,
  });
}

export interface UpdateProposalBlockInput {
  blockId: string;
  content: unknown;
}

export function useUpdateProposalBlock(
  proposalId: string,
): UseMutationResult<ProposalBlock, ApiError, UpdateProposalBlockInput> {
  const queryClient = useQueryClient();
  const queryKey = proposalBlocksQueryKey(proposalId);

  return useMutation({
    mutationFn: ({ blockId, content }) =>
      apiFetch<ProposalBlock>(`/api/proposal-blocks/${blockId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposalId, content }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData<ProposalBlock[]>(queryKey, (old) =>
        old?.map((block) => (block.id === data.id ? data : block)) ?? old,
      );
      queryClient.invalidateQueries({ queryKey: proposalSendStateQueryKey(proposalId) });
    },
    onError: () => {
      toast.error("Não foi possível salvar. Tente novamente.");
    },
  });
}
