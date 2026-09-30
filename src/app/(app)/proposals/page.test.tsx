// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProposalQueueDto, QueueItemDto } from "@/hooks/use-proposal-queue";

let data: ProposalQueueDto | undefined;
let isLoading = false;
let isError = false;
const refetchMock = vi.fn();
const useProposalQueueMock = vi.fn();
let isCreator = false;

vi.mock("@/hooks/use-proposal-queue", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/use-proposal-queue")>("@/hooks/use-proposal-queue");
  return {
    ...actual,
    useProposalQueue: (includeArchived: boolean) => {
      useProposalQueueMock(includeArchived);
      return { data, isLoading, isError, refetch: refetchMock };
    },
  };
});

vi.mock("@/components/shell/session-role-context", () => ({
  useIsCreator: () => isCreator,
}));

import ProposalsPage from "./page";

const item = (overrides: Partial<QueueItemDto>): QueueItemDto => ({
  id: "p1",
  title: "Proposta Marca X",
  situation: "draft",
  creatorName: "Thais",
  counterpartName: "Marca X",
  totalCents: 700000,
  lastActivityAt: "2026-09-28T12:00:00Z",
  latestVersionNumber: 1,
  latestPublication: null,
  changes: null,
  approvedByCreator: false,
  approvalStale: false,
  clientOutcome: null,
  ...overrides,
});

describe("ProposalsPage", () => {
  beforeEach(() => {
    data = undefined;
    isLoading = false;
    isError = false;
    isCreator = false;
    refetchMock.mockReset();
    useProposalQueueMock.mockReset();
  });

  it("agency view: group headings with counts, empty groups absent, row content, links", () => {
    data = {
      items: [
        item({ id: "p1", situation: "changes_requested", changes: { by: "client", name: "Maria", excerpt: "Trocar a capa" } }),
        item({ id: "p2", situation: "ready_to_send", approvedByCreator: true }),
        item({ id: "p3", situation: "draft" }),
      ],
      closedCount: 0,
      truncated: false,
    };
    render(<ProposalsPage />);

    expect(screen.getByText("Ajustes pedidos (1)")).toBeInTheDocument();
    expect(screen.getByText("Pronta para enviar (1)")).toBeInTheDocument();
    expect(screen.getByText("Rascunho (1)")).toBeInTheDocument();
    expect(screen.queryByText(/Aguardando creator/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Aguardando cliente/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Fechadas/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Arquivadas/)).not.toBeInTheDocument();

    const links = screen.getAllByRole("link", { name: /Proposta Marca X/ });
    const link = links.find((l) => l.getAttribute("href") === "/proposals/p1")!;
    expect(link).toBeTruthy();
    expect(link).toHaveTextContent("Thais");
    expect(link).toHaveTextContent("Marca X");
    expect(link).toHaveTextContent("R$ 7.000,00");
    expect(link).toHaveTextContent("Maria pediu: Trocar a capa");
  });

  it("creator view: awaiting_creator first, ready_to_send+draft merged under Com a agência, no creator name shown", () => {
    isCreator = true;
    data = {
      items: [
        item({ id: "p1", situation: "awaiting_creator", latestVersionNumber: 2 }),
        item({ id: "p2", situation: "ready_to_send" }),
        item({ id: "p3", situation: "draft" }),
      ],
      closedCount: 0,
      truncated: false,
    };
    render(<ProposalsPage />);

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toBe("Aguardando sua aprovação (1)");
    expect(screen.getByText("Com a agência (2)")).toBeInTheDocument();

    const links = screen.getAllByRole("link", { name: /Proposta Marca X/ });
    for (const link of links) {
      expect(link.textContent).not.toContain("Thais");
    }
  });

  it("Mostrar arquivadas toggles the hook argument and its own label", async () => {
    data = { items: [item({ id: "p1", situation: "archived" })], closedCount: 0, truncated: false };
    render(<ProposalsPage />);

    expect(useProposalQueueMock).toHaveBeenLastCalledWith(false);
    const toggle = screen.getByRole("button", { name: "Mostrar arquivadas" });
    await userEvent.click(toggle);
    expect(useProposalQueueMock).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("button", { name: "Ocultar arquivadas" })).toBeInTheDocument();
    expect(screen.getByText("Arquivadas (1)")).toBeInTheDocument();
  });

  it("truncated note", () => {
    data = { items: [item({ id: "p1" })], closedCount: 0, truncated: true };
    render(<ProposalsPage />);
    expect(screen.getByText("Mostrando as 200 propostas mais recentes.")).toBeInTheDocument();
  });

  it("empty state", () => {
    data = { items: [], closedCount: 0, truncated: false };
    render(<ProposalsPage />);
    expect(screen.getByText("Nenhuma proposta ainda.")).toBeInTheDocument();
    expect(screen.getByText("Propostas são criadas a partir de uma oportunidade no Pipeline.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Ir para o Pipeline" });
    expect(link).toHaveAttribute("href", "/pipeline");
  });

  it("loading state", () => {
    isLoading = true;
    render(<ProposalsPage />);
    expect(screen.getByText("Carregando...")).toBeInTheDocument();
  });

  it("error state retries", async () => {
    isError = true;
    render(<ProposalsPage />);
    expect(screen.getByText("Não foi possível carregar as propostas.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(refetchMock).toHaveBeenCalled();
  });
});
