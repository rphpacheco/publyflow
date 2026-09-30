import { describe, it, expect } from "vitest";
import { deriveQueueSituation } from "./queue-situation";
import { computeSendFlags } from "@/services/proposal-sending.service";
import type { ProposalStatus } from "@/lib/proposal-themes";
import type { ApprovalState } from "./approval-state";

function situation(status: ProposalStatus, latest: number, published: number | null, approvalState: ApprovalState) {
  const flags = computeSendFlags({ status, latestVersionNumber: latest, latestPublicationVersionNumber: published });
  return deriveQueueSituation({ status, ...flags, approvalState, hasPublication: published !== null });
}

describe("deriveQueueSituation (spec §3)", () => {
  it.each([
    // [status, latestVersion, publishedVersion, approvalState, expected]
    ["ARCHIVED", 2, 1, "not_required", "archived"],
    ["ARCHIVED", 2, null, "changes_requested", "archived"],
    ["DRAFT", 1, null, "changes_requested", "changes_requested"],
    ["SENT", 2, 2, "changes_requested", "awaiting_client"],
    ["APPROVED", 2, 2, "changes_requested", "closed"],
    ["REJECTED", 2, 2, "changes_requested", "closed"],
    ["CHANGES_REQUESTED", 2, 2, "not_required", "changes_requested"],
    ["CHANGES_REQUESTED", 3, 2, "not_required", "ready_to_send"],
    ["CHANGES_REQUESTED", 3, 2, "pending", "awaiting_creator"],
    ["CHANGES_REQUESTED", 3, 2, "none", "draft"],
    ["DRAFT", 1, null, "approved", "ready_to_send"],
    ["SENT", 3, 2, "not_required", "ready_to_send"],
    ["DRAFT", 1, null, "not_required", "draft"],
    ["DRAFT", 1, null, "pending", "awaiting_creator"],
    ["DRAFT", 2, null, "stale", "draft"],
    ["DRAFT", 1, null, "none", "draft"],
    ["SENT", 2, 2, "not_required", "awaiting_client"],
    ["SENT", 2, 2, "stale", "awaiting_client"],
    ["APPROVED", 2, 2, "not_required", "closed"],
    ["REJECTED", 2, 2, "approved", "closed"],
    ["APPROVED", 3, 2, "not_required", "ready_to_send"],
    ["REJECTED", 3, 2, "none", "draft"],
  ] as const)("%s v%s published v%s approval=%s → %s", (status, latest, published, approvalState, expected) => {
    expect(situation(status, latest, published, approvalState)).toBe(expected);
  });
});
