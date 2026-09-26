import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/api-client";
import type { ProposalStatus } from "@/lib/proposal-themes";
import { proposalQueryKey } from "./use-proposal";
import { proposalSendStateQueryKey, proposalPublicationsQueryKey } from "./proposal-sending-keys";

export { proposalSendStateQueryKey, proposalPublicationsQueryKey };

export interface SendStateResponseDto {
  action: "ACCEPT" | "REQUEST_CHANGES" | "REJECT";
  respondentName: string;
  respondentEmail: string;
  message: string | null;
  respondedAt: string;
}

export interface SendStateDto {
  status: ProposalStatus;
  publicPath: string | null;
  latestPublication: { id: string; versionNumber: number; publishedAt: string; response: SendStateResponseDto | null } | null;
  latestVersionNumber: number;
  hasUnsentChanges: boolean;
  canSend: boolean;
}

export interface PublicationHistoryItemDto {
  id: string;
  publicationNumber: number;
  versionNumber: number;
  publishedAt: string;
  response: SendStateResponseDto | null;
}

export interface PublishResultDto {
  publication: { id: string; versionNumber: number };
  publicPath: string;
  created: boolean;
}

export function useProposalSendState(proposalId: string): UseQueryResult<SendStateDto> {
  return useQuery({
    queryKey: proposalSendStateQueryKey(proposalId),
    queryFn: () => apiFetch<SendStateDto>(`/api/proposals/${proposalId}/send-state`),
  });
}

export function useProposalPublications(proposalId: string): UseQueryResult<PublicationHistoryItemDto[]> {
  return useQuery({
    queryKey: proposalPublicationsQueryKey(proposalId),
    queryFn: () => apiFetch<PublicationHistoryItemDto[]>(`/api/proposals/${proposalId}/publications`),
  });
}

export function usePublishProposal(proposalId: string): UseMutationResult<PublishResultDto, ApiError, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<PublishResultDto>(`/api/proposals/${proposalId}/publications`, { method: "POST" }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: proposalSendStateQueryKey(proposalId) });
      queryClient.invalidateQueries({ queryKey: proposalPublicationsQueryKey(proposalId) });
      queryClient.invalidateQueries({ queryKey: proposalQueryKey(proposalId) });
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    },
    onError: () => {
      toast.error("Não foi possível enviar a proposta. Tente novamente.");
    },
  });
}
