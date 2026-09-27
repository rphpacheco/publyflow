import { describe, it, expect } from "vitest";
import { notificationCopy } from "./proposal-notifications";

const event = (eventType: string) =>
  ({ eventType, payload: { proposal_id: "p1", proposal_title: "Campanha Verão", respondent_name: "Maria" } }) as never;

describe("notificationCopy", () => {
  it.each([
    ["proposal.approved", "Proposta aceita", 'Maria aceitou "Campanha Verão".'],
    ["proposal.changes_requested", "Ajustes pedidos", 'Maria pediu ajustes em "Campanha Verão".'],
    ["proposal.rejected", "Proposta recusada", 'Maria recusou "Campanha Verão".'],
  ])("%s", (type, title, body) => {
    expect(notificationCopy(event(type))).toEqual({ kind: type, title, body, linkPath: "/proposals/p1" });
  });

  it("returns null for events that do not notify", () => {
    expect(notificationCopy(event("proposal.sent"))).toBeNull();
  });
});
