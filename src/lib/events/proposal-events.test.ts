import { describe, it, expect } from "vitest";
import { excerpt, proposalResponseEvent, proposalSentEvent } from "./proposal-events";

const base = { proposalId: "p1", proposalTitle: "Campanha", publicationId: "pub1", versionNumber: 2, opportunityId: "o1" };

describe("proposal event builders", () => {
  it("builds proposal.sent without PII", () => {
    expect(proposalSentEvent({ ...base, userId: "u1" })).toEqual({
      eventType: "proposal.sent",
      entityType: "proposal",
      entityId: "p1",
      payload: { proposal_id: "p1", proposal_title: "Campanha", publication_id: "pub1", version_number: 2, opportunity_id: "o1" },
      actor: { kind: "user", user_id: "u1" },
    });
  });

  it("maps each response to its event with an excerpt", () => {
    const changes = proposalResponseEvent({ ...base, action: "REQUEST_CHANGES", respondentName: "Maria", message: "Trocar stories" });
    expect(changes.eventType).toBe("proposal.changes_requested");
    expect(changes.payload).toMatchObject({ respondent_name: "Maria", message_excerpt: "Trocar stories" });
    expect(changes.actor).toEqual({ kind: "client", name: "Maria" });

    const rejected = proposalResponseEvent({ ...base, action: "REJECT", respondentName: "Maria", message: null });
    expect(rejected.eventType).toBe("proposal.rejected");
    expect(rejected.payload).toMatchObject({ reason_excerpt: null });

    const approved = proposalResponseEvent({ ...base, action: "ACCEPT", respondentName: "Maria", message: null });
    expect(approved.eventType).toBe("proposal.approved");
    expect(approved.payload).not.toHaveProperty("message_excerpt");
  });

  it("caps excerpts at 140 characters", () => {
    expect(excerpt("a".repeat(200))).toBe("a".repeat(139) + "…");
    expect(excerpt("  curto  ")).toBe("curto");
    expect(excerpt(null)).toBeNull();
  });
});
