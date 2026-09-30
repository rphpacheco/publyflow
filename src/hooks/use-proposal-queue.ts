import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";

export type QueueSituationDto =
  | "changes_requested"
  | "ready_to_send"
  | "awaiting_creator"
  | "draft"
  | "awaiting_client"
  | "closed"
  | "archived";

export interface QueueItemDto {
  id: string;
  title: string;
  situation: QueueSituationDto;
  creatorName: string;
  counterpartName: string | null;
  totalCents: number;
  lastActivityAt: string;
  latestVersionNumber: number;
  latestPublication: { versionNumber: number; publishedAt: string } | null;
  changes: { by: "client" | "creator"; name: string; excerpt: string } | null;
  approvedByCreator: boolean;
  approvalStale: boolean;
  clientOutcome: { action: "ACCEPT" | "REJECT"; name: string; at: string } | null;
}

export interface ProposalQueueDto {
  items: QueueItemDto[];
  closedCount: number;
  truncated: boolean;
}

export function useProposalQueue(includeArchived: boolean): UseQueryResult<ProposalQueueDto> {
  return useQuery({
    queryKey: ["proposals", "queue", includeArchived],
    queryFn: () => apiFetch<ProposalQueueDto>(`/api/proposals/queue${includeArchived ? "?includeArchived=1" : ""}`),
    placeholderData: keepPreviousData,
  });
}
