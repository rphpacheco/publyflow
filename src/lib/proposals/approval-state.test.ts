import { describe, it, expect } from "vitest";
import { deriveApprovalState } from "./approval-state";

describe("deriveApprovalState (spec D §4.2)", () => {
  it.each([
    [false, 3, null, "not_required"],
    [false, 3, { versionNumber: 3, decision: "APPROVED" }, "not_required"],
    [true, 3, null, "none"],
    [true, 3, { versionNumber: 2, decision: null }, "stale"],
    [true, 3, { versionNumber: 2, decision: "APPROVED" }, "stale"],
    [true, 3, { versionNumber: 3, decision: null }, "pending"],
    [true, 3, { versionNumber: 3, decision: "APPROVED" }, "approved"],
    [true, 3, { versionNumber: 3, decision: "CHANGES_REQUESTED" }, "changes_requested"],
  ] as const)("required=%s latest v%s request %j → %s", (required, latestVersionNumber, latest, expected) => {
    expect(deriveApprovalState({ required, latestVersionNumber, latest })).toBe(expected);
  });
});
