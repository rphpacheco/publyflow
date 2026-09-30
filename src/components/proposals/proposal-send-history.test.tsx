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
      { id: "b", publicationNumber: 2, versionNumber: 4, publishedAt: "2026-09-26T12:00:00.000Z", response: null, approvedByName: null, sentWithoutApproval: false },
      {
        id: "a",
        publicationNumber: 1,
        versionNumber: 3,
        publishedAt: "2026-09-25T17:32:00.000Z",
        response: { action: "REQUEST_CHANGES", respondentName: "Maria", respondentEmail: "m@x.test", message: "Trocar stories", respondedAt: "2026-09-25T20:00:00.000Z" },
        approvedByName: null,
        sentWithoutApproval: false,
      },
    ];
    render(<ProposalSendHistory proposalId="p1" status="SENT" />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Versão 4 · 26/09/2026, 09:00 · aguardando");
    expect(items[1]).toHaveTextContent("Versão 3 · 25/09/2026, 14:32 · ajustes: Trocar stories");
  });

  it("latest unanswered publication with status ARCHIVED reads sem resposta", () => {
    state.data = [
      { id: "b", publicationNumber: 2, versionNumber: 4, publishedAt: "2026-09-26T12:00:00.000Z", response: null, approvedByName: null, sentWithoutApproval: false },
    ];
    render(<ProposalSendHistory proposalId="p1" status="ARCHIVED" />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Versão 4 · 26/09/2026, 09:00 · sem resposta");
  });

  it("a non-latest unanswered publication reads substituída", () => {
    state.data = [
      { id: "c", publicationNumber: 3, versionNumber: 5, publishedAt: "2026-09-27T12:00:00.000Z", response: null, approvedByName: null, sentWithoutApproval: false },
      { id: "b", publicationNumber: 2, versionNumber: 4, publishedAt: "2026-09-26T09:00:00.000Z", response: null, approvedByName: null, sentWithoutApproval: false },
    ];
    render(<ProposalSendHistory proposalId="p1" status="SENT" />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Versão 5 · 27/09/2026, 09:00 · aguardando");
    expect(items[1]).toHaveTextContent("Versão 4 · 26/09/2026, 06:00 · substituída");
  });

  it("appends ' · aprovada por {name}' when the publication was approved", () => {
    state.data = [
      { id: "b", publicationNumber: 2, versionNumber: 4, publishedAt: "2026-09-26T12:00:00.000Z", response: null, approvedByName: "Thais", sentWithoutApproval: false },
    ];
    render(<ProposalSendHistory proposalId="p1" status="SENT" />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Versão 4 · 26/09/2026, 09:00 · aguardando · aprovada por Thais");
  });

  it("appends ' · enviada sem aprovação' when sent without approval", () => {
    state.data = [
      { id: "b", publicationNumber: 2, versionNumber: 4, publishedAt: "2026-09-26T12:00:00.000Z", response: null, approvedByName: null, sentWithoutApproval: true },
    ];
    render(<ProposalSendHistory proposalId="p1" status="SENT" />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Versão 4 · 26/09/2026, 09:00 · aguardando · enviada sem aprovação");
  });

  it("legacy item without approvedByName/sentWithoutApproval keeps the text unchanged", () => {
    state.data = [
      { id: "b", publicationNumber: 2, versionNumber: 4, publishedAt: "2026-09-26T12:00:00.000Z", response: null, approvedByName: null, sentWithoutApproval: false },
    ];
    render(<ProposalSendHistory proposalId="p1" status="SENT" />);
    const items = screen.getAllByRole("listitem");
    expect(items[0].textContent).toBe("Versão 4 · 26/09/2026, 09:00 · aguardando");
  });
});
