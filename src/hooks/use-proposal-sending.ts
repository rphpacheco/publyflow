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

export type ApprovalStateDto = "not_required" | "none" | "pending" | "approved" | "changes_requested" | "stale";

export interface SendStateApprovalDto {
  state: ApprovalStateDto;
  required: boolean;
  creatorName: string | null;
  current: {
    id: string;
    versionNumber: number;
    requestedAt: string;
    requestedByName: string;
    decision: "APPROVED" | "CHANGES_REQUESTED" | null;
    decidedAt: string | null;
    message: string | null;
  } | null;
}

export interface SendStateDto {
  status: ProposalStatus;
  publicPath: string | null;
  latestPublication:
    | { id: string; versionNumber: number; publishedAt: string; response: SendStateResponseDto | null; sentWithoutApproval: boolean }
    | null;
  latestVersionNumber: number;
  hasUnsentChanges: boolean;
  canSend: boolean;
  approval: SendStateApprovalDto;
}

export interface PublicationHistoryItemDto {
  id: string;
  publicationNumber: number;
  versionNumber: number;
  publishedAt: string;
  response: SendStateResponseDto | null;
  approvedByName: string | null;
  sentWithoutApproval: boolean;
}

export interface PublishResultDto {
  publication: { id: string; versionNumber: number };
  publicPath: string;
  created: boolean;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

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

export function usePublishProposal(proposalId: string): UseMutationResult<PublishResultDto, ApiError, { withoutApproval?: boolean } | void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { withoutApproval?: boolean } | void) =>
      apiFetch<PublishResultDto>(
        `/api/proposals/${proposalId}/publications`,
        json("POST", { withoutApproval: variables?.withoutApproval === true }),
      ),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: proposalSendStateQueryKey(proposalId) });
      queryClient.invalidateQueries({ queryKey: proposalPublicationsQueryKey(proposalId) });
      queryClient.invalidateQueries({ queryKey: proposalQueryKey(proposalId) });
      queryClient.invalidateQueries({ queryKey: ["proposals"] });
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    },
    onError: (error) => {
      toast.error(error instanceof ApiError && error.status === 409 ? error.message : "Não foi possível enviar a proposta. Tente novamente.");
    },
  });
}

function extractFieldError(body: unknown): string | undefined {
  if (body && typeof body === "object" && "errors" in body) {
    const errors = (body as { errors?: Record<string, unknown> }).errors;
    const first = errors?.message;
    if (Array.isArray(first) && typeof first[0] === "string") return first[0];
  }
  return undefined;
}

function useApprovalMutation<V>(proposalId: string, path: string, successToast: string) {
  const queryClient = useQueryClient();
  return useMutation<{ approval: unknown }, ApiError, V>({
    mutationFn: (variables: V) => apiFetch<{ approval: unknown }>(`/api/proposals/${proposalId}/${path}`, json("POST", variables ?? {})),
    onSuccess: () => toast.success(successToast),
    onError: (error) => {
      if (error.status === 409) {
        toast.error(error.message);
      } else if (error.status === 400) {
        toast.error(extractFieldError(error.body) ?? "Descreva os ajustes.");
      } else {
        toast.error("Não foi possível concluir. Tente novamente.");
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: proposalSendStateQueryKey(proposalId) });
      queryClient.invalidateQueries({ queryKey: proposalPublicationsQueryKey(proposalId) });
    },
  });
}

export const useRequestApproval = (proposalId: string) => useApprovalMutation<void>(proposalId, "approval", "Pedido de aprovação enviado.");
export const useApproveProposal = (proposalId: string) =>
  useApprovalMutation<{ approvalId: string; message?: string }>(proposalId, "approval/approve", "Proposta aprovada.");
export const useRequestProposalChanges = (proposalId: string) =>
  useApprovalMutation<{ approvalId: string; message: string }>(proposalId, "approval/request-changes", "Pedido de ajustes enviado.");
