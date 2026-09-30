export type ApprovalState = "not_required" | "none" | "pending" | "approved" | "changes_requested" | "stale";

/** Spec D §4.2 — derived, never stored. */
export function deriveApprovalState(input: {
  required: boolean;
  latestVersionNumber: number;
  latest: { versionNumber: number; decision: "APPROVED" | "CHANGES_REQUESTED" | null } | null;
}): ApprovalState {
  if (!input.required) return "not_required";
  if (!input.latest) return "none";
  if (input.latest.versionNumber !== input.latestVersionNumber) return "stale";
  if (input.latest.decision === "APPROVED") return "approved";
  if (input.latest.decision === "CHANGES_REQUESTED") return "changes_requested";
  return "pending";
}
