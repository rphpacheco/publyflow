// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/use-proposal-sending", () => ({
  useProposalPublications: () => ({
    data: [
      { id: "b", publicationNumber: 2, versionNumber: 4, publishedAt: "2026-09-26T12:00:00.000Z", response: null },
      {
        id: "a",
        publicationNumber: 1,
        versionNumber: 3,
        publishedAt: "2026-09-25T17:32:00.000Z",
        response: { action: "REQUEST_CHANGES", respondentName: "Maria", respondentEmail: "m@x.test", message: "Trocar stories", respondedAt: "2026-09-25T20:00:00.000Z" },
      },
    ],
  }),
}));

import { ProposalSendHistory } from "./proposal-send-history";

describe("ProposalSendHistory", () => {
  it("lists every publication, latest first, with its result", () => {
    render(<ProposalSendHistory proposalId="p1" />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Versão 4 · 26/09/2026, 09:00 · aguardando");
    expect(items[1]).toHaveTextContent("Versão 3 · 25/09/2026, 14:32 · ajustes: Trocar stories");
  });
});
