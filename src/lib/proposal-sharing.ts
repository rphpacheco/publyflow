import type { ProposalStatus } from "@/lib/proposal-themes";
import type { PresentationResponseAction } from "@/lib/presentation/types";

/** 32 random bytes in base64url. */
export const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isPublicTokenFormat(token: string): boolean {
  return PUBLIC_TOKEN_PATTERN.test(token);
}

export function publicPathFor(token: string): string {
  return `/p/${token}`;
}

export const RESPONSE_STATUS: Record<PresentationResponseAction, ProposalStatus> = {
  ACCEPT: "APPROVED",
  REQUEST_CHANGES: "CHANGES_REQUESTED",
  REJECT: "REJECTED",
};

export const RESPONSE_STAGE: Record<PresentationResponseAction, "NEGOCIACAO" | "FECHADO" | "PERDIDO"> = {
  ACCEPT: "FECHADO",
  REQUEST_CHANGES: "NEGOCIACAO",
  REJECT: "PERDIDO",
};

export const SENT_STAGE = "PROPOSTA_ENVIADA" as const;

/** Opportunities in these stages are never moved by the automation. */
export const CLOSED_STAGES: ReadonlySet<string> = new Set(["FECHADO", "PERDIDO"]);
