import type { ProposalStatus } from "@/lib/proposal-themes";
import type { ApprovalState } from "./approval-state";

export type QueueSituation =
  | "changes_requested"
  | "ready_to_send"
  | "awaiting_creator"
  | "draft"
  | "awaiting_client"
  | "closed"
  | "archived";

/** Spec §3 — first match wins. */
export function deriveQueueSituation(input: {
  status: ProposalStatus;
  hasUnsentChanges: boolean;
  canSend: boolean;
  approvalState: ApprovalState;
  hasPublication: boolean;
}): QueueSituation {
  if (input.status === "ARCHIVED") return "archived";
  if (input.approvalState === "changes_requested" && input.canSend) return "changes_requested";
  if (input.status === "CHANGES_REQUESTED" && !input.hasUnsentChanges) return "changes_requested";
  if (input.canSend) {
    if (input.approvalState === "approved") return "ready_to_send";
    if (input.approvalState === "not_required" && input.hasPublication) return "ready_to_send";
    if (input.approvalState === "pending") return "awaiting_creator";
    return "draft";
  }
  if (input.status === "SENT") return "awaiting_client";
  // Last return reached only for APPROVED/REJECTED with nothing to send
  // (DRAFT always has canSend; ARCHIVED returned earlier; CHANGES_REQUESTED without unsent changes returned earlier)
  return "closed";
}
