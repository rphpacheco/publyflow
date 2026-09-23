import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { apiFetch, ApiError } from "@/lib/api-client";

export interface SendMessageInput {
  organizationId: string;
  creatorId: string;
  source: "INSTAGRAM" | "WHATSAPP" | "TIKTOK";
  externalContactLabel: string;
  body: string;
}

export function useSendInboxMessage(): UseMutationResult<unknown, ApiError, SendMessageInput> {
  return useMutation({
    mutationFn: (input: SendMessageInput) =>
      apiFetch("/api/inbox/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
  });
}
