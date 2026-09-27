// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SendStateDto } from "@/hooks/use-proposal-sending";

let sendState: SendStateDto | undefined;
const mutateMock = vi.fn();
vi.mock("@/hooks/use-proposal-sending", () => ({
  useProposalSendState: () => ({ data: sendState, isLoading: false }),
  usePublishProposal: () => ({ mutate: mutateMock, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/use-proposal-share-info", () => ({ useProposalShareInfo: () => ({ data: undefined }) }));

import { ProposalSendPanel } from "./proposal-send-panel";

const published = { id: "pub1", versionNumber: 3, publishedAt: "2026-09-25T17:32:00.000Z", response: null };
const accepted = {
  ...published,
  response: { action: "ACCEPT" as const, respondentName: "Maria", respondentEmail: "maria@bella.test", message: null, respondedAt: "2026-09-26T12:00:00.000Z" },
};
const changes = {
  ...published,
  response: { action: "REQUEST_CHANGES" as const, respondentName: "Maria", respondentEmail: "maria@bella.test", message: "Trocar stories", respondedAt: "2026-09-26T12:00:00.000Z" },
};

function state(overrides: Partial<SendStateDto>): SendStateDto {
  return { status: "DRAFT", publicPath: null, latestPublication: null, latestVersionNumber: 1, hasUnsentChanges: true, canSend: true, ...overrides };
}

describe("ProposalSendPanel", () => {
  beforeEach(() => {
    mutateMock.mockReset();
  });

  it("DRAFT never sent: 'Enviar proposta' and 'Ainda não enviada.'", async () => {
    sendState = state({});
    render(<ProposalSendPanel proposalId="p1" />);
    expect(screen.getByText("Ainda não enviada.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Enviar proposta" }));
    expect(mutateMock).toHaveBeenCalled();
  });

  it("SENT without changes: waiting, link actions, Reenviar disabled with hint", () => {
    sendState = state({ status: "SENT", publicPath: "/p/tok", latestPublication: published, latestVersionNumber: 3, hasUnsentChanges: false, canSend: false });
    render(<ProposalSendPanel proposalId="p1" />);
    expect(screen.getByText(/Aguardando resposta · versão 3 enviada em/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reenviar" })).toBeDisabled();
    expect(screen.getByText("Nada mudou desde o envio")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar link" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir" })).toHaveAttribute("href", "/p/tok");
  });

  it("SENT with changes: document warning and Reenviar without confirmation", async () => {
    sendState = state({ status: "SENT", publicPath: "/p/tok", latestPublication: published, latestVersionNumber: 4, hasUnsentChanges: true, canSend: true });
    render(<ProposalSendPanel proposalId="p1" />);
    expect(screen.getByText("Alterações não enviadas — o cliente ainda vê a versão 3.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reenviar" }));
    expect(mutateMock).toHaveBeenCalled();
  });

  it("CHANGES_REQUESTED: shows who asked and the message; without changes hints to edit", () => {
    sendState = state({ status: "CHANGES_REQUESTED", publicPath: "/p/tok", latestPublication: changes, latestVersionNumber: 3, hasUnsentChanges: false, canSend: false });
    render(<ProposalSendPanel proposalId="p1" />);
    expect(screen.getByText("Ajustes pedidos")).toBeInTheDocument();
    expect(screen.getByText(/Maria · maria@bella.test ·/)).toBeInTheDocument();
    expect(screen.getByText("Trocar stories")).toBeInTheDocument();
    expect(screen.getByText("Edite a proposta e reenvie")).toBeInTheDocument();
  });

  it("CHANGES_REQUESTED with changes resends without confirmation", async () => {
    sendState = state({ status: "CHANGES_REQUESTED", publicPath: "/p/tok", latestPublication: changes, latestVersionNumber: 4, hasUnsentChanges: true, canSend: true });
    render(<ProposalSendPanel proposalId="p1" />);
    await userEvent.click(screen.getByRole("button", { name: "Reenviar" }));
    expect(mutateMock).toHaveBeenCalled();
    expect(screen.queryByText("Abrir nova rodada?")).not.toBeInTheDocument();
  });

  it("APPROVED with changes: negotiation and document shown separately, resend asks for confirmation", async () => {
    sendState = state({ status: "APPROVED", publicPath: "/p/tok", latestPublication: accepted, latestVersionNumber: 4, hasUnsentChanges: true, canSend: true });
    render(<ProposalSendPanel proposalId="p1" />);
    expect(screen.getByText("Aceita")).toBeInTheDocument();
    expect(screen.getByText("Alterações não enviadas — o cliente ainda vê a versão 3.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Reenviar" }));
    expect(mutateMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Esta proposta já foi aceita. Reenviar abre uma nova rodada e o status volta para Enviada.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Reenviar" }));
    expect(mutateMock).toHaveBeenCalled();
  });

  it("REJECTED with changes asks for confirmation with the rejected copy", async () => {
    sendState = state({
      status: "REJECTED",
      publicPath: "/p/tok",
      latestPublication: { ...accepted, response: { ...accepted.response, action: "REJECT" } },
      latestVersionNumber: 4,
      hasUnsentChanges: true,
      canSend: true,
    });
    render(<ProposalSendPanel proposalId="p1" />);
    await userEvent.click(screen.getByRole("button", { name: "Reenviar" }));
    expect(screen.getByText("Esta proposta já foi recusada. Reenviar abre uma nova rodada e o status volta para Enviada.")).toBeInTheDocument();
  });

  it("DRAFT after unarchiving: link disabled message and Reenviar", () => {
    sendState = state({ status: "DRAFT", publicPath: null, latestPublication: accepted, latestVersionNumber: 5, hasUnsentChanges: true, canSend: true });
    render(<ProposalSendPanel proposalId="p1" />);
    expect(screen.getByText("O link está desativado até você reenviar.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reenviar" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Copiar link" })).not.toBeInTheDocument();
  });

  it("ARCHIVED renders nothing", () => {
    sendState = state({ status: "ARCHIVED", canSend: false });
    const { container } = render(<ProposalSendPanel proposalId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
