import type { AppendEventInput } from "@/repositories/domain-events.repository";

export const PROPOSAL_EVENT = {
  SENT: "proposal.sent",
  APPROVED: "proposal.approved",
  CHANGES_REQUESTED: "proposal.changes_requested",
  REJECTED: "proposal.rejected",
} as const;

type ResponseAction = "ACCEPT" | "REQUEST_CHANGES" | "REJECT";

export const RESPONSE_EVENT: Record<ResponseAction, string> = {
  ACCEPT: PROPOSAL_EVENT.APPROVED,
  REQUEST_CHANGES: PROPOSAL_EVENT.CHANGES_REQUESTED,
  REJECT: PROPOSAL_EVENT.REJECTED,
};

const EXCERPT_MAX = 140;

export function excerpt(text: string | null, max = EXCERPT_MAX): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  // Truncate by code points, not UTF-16 code units: slicing a raw string can
  // split a surrogate pair (e.g. an emoji), leaving a lone surrogate that
  // JSON.stringify writes as an unpaired \uXXXX escape — Postgres jsonb
  // rejects that, failing the whole transaction that wrote this payload.
  const chars = Array.from(trimmed);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : trimmed;
}

interface ProposalRef {
  proposalId: string;
  proposalTitle: string;
  publicationId: string;
  versionNumber: number;
  opportunityId: string;
}

function basePayload(ref: ProposalRef) {
  return {
    proposal_id: ref.proposalId,
    proposal_title: ref.proposalTitle,
    publication_id: ref.publicationId,
    version_number: ref.versionNumber,
    opportunity_id: ref.opportunityId,
  };
}

export function proposalSentEvent(input: ProposalRef & { userId: string }): AppendEventInput {
  return {
    eventType: PROPOSAL_EVENT.SENT,
    entityType: "proposal",
    entityId: input.proposalId,
    payload: basePayload(input),
    actor: { kind: "user", user_id: input.userId },
  };
}

export function proposalResponseEvent(
  input: ProposalRef & { action: ResponseAction; respondentName: string; message: string | null },
): AppendEventInput {
  const payload: Record<string, unknown> = { ...basePayload(input), respondent_name: input.respondentName };
  if (input.action === "REQUEST_CHANGES") payload.message_excerpt = excerpt(input.message);
  if (input.action === "REJECT") payload.reason_excerpt = excerpt(input.message);
  return {
    eventType: RESPONSE_EVENT[input.action],
    entityType: "proposal",
    entityId: input.proposalId,
    payload,
    actor: { kind: "client", name: input.respondentName },
  };
}
