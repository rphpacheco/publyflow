// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PublicationHistoryItemDto } from "@/hooks/use-proposal-sending";

const state: { data: PublicationHistoryItemDto[] } = { data: [] };

vi.mock("@/hooks/use-proposal-sending", () => ({
  useProposalPublications: () => ({ data: state.data }),
}));

import { ProposalSendHistory } from "./proposal-send-history";

describe("ProposalSendHistory", () => {
  it("latest unanswered publication with status SENT reads aguardando", () => {
    state.data = [
      { id: "b", publicationNumber: 2, versionNumber: 4, publishedAt: "2026-09-26T12:00:00.000Z", response: null },
      {
        id: "a",
        publicationNumber: 1,
        versionNumber: 3,
        publishedAt: "2026-09-25T17:32:00.000Z",
        response: { action: "REQUEST_CHANGES", respondentName: "Maria", respondentEmail: "m@x.test", message: "Trocar stories", respondedAt: "2026-09-25T20:00:00.000Z" },
      },
    ];
    render(<ProposalSendHistory proposalId="p1" status="SENT" />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Versão 4 · 26/09/2026, 09:00 · aguardando");
    expect(items[1]).toHaveTextContent("Versão 3 · 25/09/2026, 14:32 · ajustes: Trocar stories");
  });

  it("latest unanswered publication with status ARCHIVED reads sem resposta", () => {
    state.data = [
      { id: "b", publicationNumber: 2, versionNumber: 4, publishedAt: "2026-09-26T12:00:00.000Z", response: null },
    ];
    render(<ProposalSendHistory proposalId="p1" status="ARCHIVED" />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Versão 4 · 26/09/2026, 09:00 · sem resposta");
  });

  it("a non-latest unanswered publication reads substituída", () => {
    state.data = [
      { id: "c", publicationNumber: 3, versionNumber: 5, publishedAt: "2026-09-27T12:00:00.000Z", response: null },
      { id: "b", publicationNumber: 2, versionNumber: 4, publishedAt: "2026-09-26T09:00:00.000Z", response: null },
    ];
    render(<ProposalSendHistory proposalId="p1" status="SENT" />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Versão 5 · 27/09/2026, 09:00 · aguardando");
    expect(items[1]).toHaveTextContent("Versão 4 · 26/09/2026, 06:00 · substituída");
  });
});
