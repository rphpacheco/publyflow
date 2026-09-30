// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SendStateDto } from "@/hooks/use-proposal-sending";

let sendState: SendStateDto | undefined;
let freshState: SendStateDto | undefined;
let refetchFails = false;
let publishPending = false;
let requestApprovalPending = false;
const mutateMock = vi.fn();
const requestApprovalMutateMock = vi.fn();
const refetchMock = vi.fn(async () =>
  refetchFails ? { data: sendState, isError: true } : { data: freshState ?? sendState, isError: false },
);
vi.mock("@/hooks/use-proposal-sending", () => ({
  useProposalSendState: () => ({ data: sendState, isLoading: false, refetch: refetchMock }),
  usePublishProposal: () => ({ mutate: mutateMock, isPending: publishPending }),
  useRequestApproval: () => ({ mutate: requestApprovalMutateMock, isPending: requestApprovalPending }),
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (...args: unknown[]) => toastError(...args) } }));
vi.mock("@/hooks/use-proposal-share-info", () => ({ useProposalShareInfo: () => ({ data: undefined }) }));

import { ProposalSendPanel } from "./proposal-send-panel";

const published = { id: "pub1", versionNumber: 3, publishedAt: "2026-09-25T17:32:00.000Z", response: null, sentWithoutApproval: false };
const accepted = {
  ...published,
  response: { action: "ACCEPT" as const, respondentName: "Maria", respondentEmail: "maria@bella.test", message: null, respondedAt: "2026-09-26T12:00:00.000Z" },
};
const changes = {
  ...published,
  response: { action: "REQUEST_CHANGES" as const, respondentName: "Maria", respondentEmail: "maria@bella.test", message: "Trocar stories", respondedAt: "2026-09-26T12:00:00.000Z" },
};

const notRequiredApproval: SendStateDto["approval"] = { state: "not_required", required: false, creatorName: "Thais", current: null };

function state(overrides: Partial<SendStateDto>): SendStateDto {
  return {
    status: "DRAFT",
    publicPath: null,
    latestPublication: null,
    latestVersionNumber: 1,
    hasUnsentChanges: true,
    canSend: true,
    approval: notRequiredApproval,
    ...overrides,
  };
}

describe("ProposalSendPanel", () => {
  beforeEach(() => {
    mutateMock.mockReset();
    requestApprovalMutateMock.mockReset();
    refetchMock.mockClear();
    toastError.mockReset();
    freshState = undefined;
    refetchFails = false;
    publishPending = false;
    requestApprovalPending = false;
  });

  it("DRAFT never sent: 'Enviar proposta' and 'Ainda não enviada.'", async () => {
    sendState = state({});
    render(<ProposalSendPanel proposalId="p1" />);
    expect(screen.getByText("Ainda não enviada.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Enviar proposta" }));
    await vi.waitFor(() => expect(mutateMock).toHaveBeenCalled());
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
    await vi.waitFor(() => expect(mutateMock).toHaveBeenCalled());
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
    await vi.waitFor(() => expect(mutateMock).toHaveBeenCalled());
    expect(screen.queryByText("Abrir nova rodada?")).not.toBeInTheDocument();
  });

  it("APPROVED with changes: negotiation and document shown separately, resend asks for confirmation", async () => {
    sendState = state({ status: "APPROVED", publicPath: "/p/tok", latestPublication: accepted, latestVersionNumber: 4, hasUnsentChanges: true, canSend: true });
    render(<ProposalSendPanel proposalId="p1" />);
    expect(screen.getByText("Aceita")).toBeInTheDocument();
    expect(screen.getByText("Alterações não enviadas — o cliente ainda vê a versão 3.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Reenviar" }));
    expect(mutateMock).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Esta proposta já foi aceita. Reenviar abre uma nova rodada e o status volta para Enviada.")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Reenviar" }));
    await vi.waitFor(() => expect(mutateMock).toHaveBeenCalled());
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
    expect(await screen.findByText("Esta proposta já foi recusada. Reenviar abre uma nova rodada e o status volta para Enviada.")).toBeInTheDocument();
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

  it("re-checks the state before sending and confirms when the client answered meanwhile", async () => {
    sendState = state({ status: "SENT", publicPath: "/p/tok", latestPublication: published, latestVersionNumber: 4, hasUnsentChanges: true, canSend: true });
    freshState = state({ status: "APPROVED", publicPath: "/p/tok", latestPublication: accepted, latestVersionNumber: 4, hasUnsentChanges: true, canSend: true });
    render(<ProposalSendPanel proposalId="p1" />);

    await userEvent.click(screen.getByRole("button", { name: "Reenviar" }));

    expect(refetchMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Abrir nova rodada?")).toBeInTheDocument();
    expect(
      screen.getByText("Esta proposta já foi aceita. Reenviar abre uma nova rodada e o status volta para Enviada."),
    ).toBeInTheDocument();
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("sends without confirmation when the fresh state still allows it", async () => {
    sendState = state({ status: "SENT", publicPath: "/p/tok", latestPublication: published, latestVersionNumber: 4, hasUnsentChanges: true, canSend: true });
    render(<ProposalSendPanel proposalId="p1" />);

    await userEvent.click(screen.getByRole("button", { name: "Reenviar" }));

    expect(refetchMock).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));
  });

  it("does not send when the fresh state can no longer send", async () => {
    sendState = state({ status: "SENT", publicPath: "/p/tok", latestPublication: published, latestVersionNumber: 4, hasUnsentChanges: true, canSend: true });
    freshState = { ...sendState, canSend: false };
    render(<ProposalSendPanel proposalId="p1" />);

    await userEvent.click(screen.getByRole("button", { name: "Reenviar" }));

    expect(mutateMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Abrir nova rodada?")).not.toBeInTheDocument();
  });

  it("shows a toast and does not send when the re-check fails", async () => {
    sendState = state({});
    refetchFails = true;
    render(<ProposalSendPanel proposalId="p1" />);

    await userEvent.click(screen.getByRole("button", { name: "Enviar proposta" }));

    expect(toastError).toHaveBeenCalledWith("Não foi possível verificar o estado da proposta. Tente novamente.");
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("disables the send button while re-checking", async () => {
    sendState = state({});
    let release!: () => void;
    refetchMock.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ data: sendState, isError: false }))),
    );
    render(<ProposalSendPanel proposalId="p1" />);

    await userEvent.click(screen.getByRole("button", { name: "Enviar proposta" }));
    expect(screen.getByRole("button", { name: "Verificando…" })).toBeDisabled();
    release();
    await vi.waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));
  });

  describe("approval block", () => {
    it("not_required: no approval text and Enviar proposta enabled as today", () => {
      sendState = state({ approval: { state: "not_required", required: false, creatorName: "Thais", current: null } });
      render(<ProposalSendPanel proposalId="p1" />);
      expect(screen.queryByLabelText("Aprovação do creator")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Enviar proposta" })).toBeEnabled();
    });

    it("none: shows the block, Pedir aprovação + Enviar sem aprovação, no main send button", () => {
      sendState = state({ approval: { state: "none", required: true, creatorName: "Thais", current: null } });
      render(<ProposalSendPanel proposalId="p1" />);
      expect(screen.getByText("Este creator precisa aprovar a proposta antes do envio.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Pedir aprovação" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Enviar sem aprovação" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Enviar proposta" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reenviar" })).not.toBeInTheDocument();
    });

    it("pending: shows waiting copy with creator name and version, only Enviar sem aprovação", () => {
      sendState = state({
        approval: {
          state: "pending",
          required: true,
          creatorName: "Thais",
          current: { id: "a1", versionNumber: 2, requestedAt: "2026-09-29T14:00:00.000Z", requestedByName: "Rafael", decision: null, decidedAt: null, message: null },
        },
      });
      render(<ProposalSendPanel proposalId="p1" />);
      expect(screen.getByText("Aguardando aprovação de Thais (versão 2).")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Pedir aprovação" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Enviar sem aprovação" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Enviar proposta" })).not.toBeInTheDocument();
    });

    it("approved: shows 'Aprovada por Thais em…', main send button enabled, no Enviar sem aprovação", () => {
      sendState = state({
        approval: {
          state: "approved",
          required: true,
          creatorName: "Thais",
          current: {
            id: "a1",
            versionNumber: 2,
            requestedAt: "2026-09-29T14:00:00.000Z",
            requestedByName: "Rafael",
            decision: "APPROVED",
            decidedAt: "2026-09-29T15:00:00.000Z",
            message: null,
          },
        },
      });
      render(<ProposalSendPanel proposalId="p1" />);
      expect(screen.getByText(/^Aprovada por Thais em/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Enviar proposta" })).toBeEnabled();
      expect(screen.queryByRole("button", { name: "Enviar sem aprovação" })).not.toBeInTheDocument();
    });

    it("changes_requested: shows the message and Pedir aprovação · Enviar sem aprovação", () => {
      sendState = state({
        approval: {
          state: "changes_requested",
          required: true,
          creatorName: "Thais",
          current: {
            id: "a1",
            versionNumber: 2,
            requestedAt: "2026-09-29T14:00:00.000Z",
            requestedByName: "Rafael",
            decision: "CHANGES_REQUESTED",
            decidedAt: "2026-09-29T15:00:00.000Z",
            message: "Trocar a capa",
          },
        },
      });
      render(<ProposalSendPanel proposalId="p1" />);
      expect(screen.getByText("Thais pediu ajustes:")).toBeInTheDocument();
      expect(screen.getByText("Trocar a capa")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Pedir aprovação" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Enviar sem aprovação" })).toBeInTheDocument();
    });

    it("stale: shows the changed-since-request warning and both buttons", () => {
      sendState = state({
        approval: {
          state: "stale",
          required: true,
          creatorName: "Thais",
          current: { id: "a1", versionNumber: 2, requestedAt: "2026-09-29T14:00:00.000Z", requestedByName: "Rafael", decision: null, decidedAt: null, message: null },
        },
      });
      render(<ProposalSendPanel proposalId="p1" />);
      expect(screen.getByText("A proposta mudou depois do pedido de aprovação.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Pedir aprovação" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Enviar sem aprovação" })).toBeInTheDocument();
    });

    it("clicking Enviar sem aprovação opens the confirm dialog; when the fresh state still allows it, publishes withoutApproval:true directly", async () => {
      sendState = state({ approval: { state: "none", required: true, creatorName: "Thais", current: null } });
      render(<ProposalSendPanel proposalId="p1" />);

      await userEvent.click(screen.getByRole("button", { name: "Enviar sem aprovação" }));
      const dialog = await screen.findByRole("alertdialog");
      expect(within(dialog).getByRole("heading", { name: "Enviar sem aprovação" })).toBeInTheDocument();
      expect(
        within(dialog).getByText("Thais ainda não aprovou esta versão. A proposta será enviada ao cliente e Thais será avisado(a)."),
      ).toBeInTheDocument();

      await userEvent.click(within(dialog).getByRole("button", { name: "Enviar sem aprovação" }));
      expect(refetchMock).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(mutateMock).toHaveBeenCalledWith({ withoutApproval: true }, expect.any(Object)));
    });

    it("Enviar sem aprovação on a fresh APPROVED/REJECTED state opens 'Abrir nova rodada?' and only its Reenviar publishes withoutApproval:true", async () => {
      sendState = state({ status: "SENT", approval: { state: "none", required: true, creatorName: "Thais", current: null } });
      freshState = state({
        status: "APPROVED",
        publicPath: "/p/tok",
        latestPublication: accepted,
        latestVersionNumber: 4,
        hasUnsentChanges: true,
        canSend: true,
        approval: { state: "none", required: true, creatorName: "Thais", current: null },
      });
      render(<ProposalSendPanel proposalId="p1" />);

      await userEvent.click(screen.getByRole("button", { name: "Enviar sem aprovação" }));
      const confirmDialog = await screen.findByRole("alertdialog");
      await userEvent.click(within(confirmDialog).getByRole("button", { name: "Enviar sem aprovação" }));

      const reopenDialog = await screen.findByRole("alertdialog");
      expect(within(reopenDialog).getByText("Abrir nova rodada?")).toBeInTheDocument();
      expect(mutateMock).not.toHaveBeenCalled();

      await userEvent.click(within(reopenDialog).getByRole("button", { name: "Reenviar" }));
      await vi.waitFor(() => expect(mutateMock).toHaveBeenCalledWith({ withoutApproval: true }, expect.any(Object)));
    });

    it("Enviar sem aprovação on a fresh DRAFT/SENT state publishes withoutApproval:true directly (no second dialog)", async () => {
      sendState = state({ status: "SENT", approval: { state: "none", required: true, creatorName: "Thais", current: null } });
      freshState = state({
        status: "SENT",
        publicPath: "/p/tok",
        latestPublication: published,
        latestVersionNumber: 4,
        hasUnsentChanges: true,
        canSend: true,
        approval: { state: "none", required: true, creatorName: "Thais", current: null },
      });
      render(<ProposalSendPanel proposalId="p1" />);

      await userEvent.click(screen.getByRole("button", { name: "Enviar sem aprovação" }));
      const dialog = await screen.findByRole("alertdialog");
      await userEvent.click(within(dialog).getByRole("button", { name: "Enviar sem aprovação" }));

      await vi.waitFor(() => expect(mutateMock).toHaveBeenCalledWith({ withoutApproval: true }, expect.any(Object)));
      expect(screen.queryByText("Abrir nova rodada?")).not.toBeInTheDocument();
    });

    it("Enviar sem aprovação: refetch error shows a toast and does not publish", async () => {
      sendState = state({ approval: { state: "none", required: true, creatorName: "Thais", current: null } });
      refetchFails = true;
      render(<ProposalSendPanel proposalId="p1" />);

      await userEvent.click(screen.getByRole("button", { name: "Enviar sem aprovação" }));
      const dialog = await screen.findByRole("alertdialog");
      await userEvent.click(within(dialog).getByRole("button", { name: "Enviar sem aprovação" }));

      await vi.waitFor(() =>
        expect(toastError).toHaveBeenCalledWith("Não foi possível verificar o estado da proposta. Tente novamente."),
      );
      expect(mutateMock).not.toHaveBeenCalled();
    });

    it("clicking Pedir aprovação calls the request-approval mutation", async () => {
      sendState = state({ approval: { state: "none", required: true, creatorName: "Thais", current: null } });
      render(<ProposalSendPanel proposalId="p1" />);

      await userEvent.click(screen.getByRole("button", { name: "Pedir aprovação" }));
      expect(requestApprovalMutateMock).toHaveBeenCalled();
    });

    it("disables approval buttons while a mutation is pending", () => {
      requestApprovalPending = true;
      sendState = state({ approval: { state: "none", required: true, creatorName: "Thais", current: null } });
      render(<ProposalSendPanel proposalId="p1" />);
      expect(screen.getByRole("button", { name: "Pedir aprovação" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Enviar sem aprovação" })).toBeDisabled();
    });

    it("renders nothing when there is nothing to send even if approval is required", () => {
      sendState = state({
        status: "SENT",
        publicPath: "/p/tok",
        latestPublication: published,
        canSend: false,
        approval: { state: "none", required: true, creatorName: "Thais", current: null },
      });
      render(<ProposalSendPanel proposalId="p1" />);
      expect(screen.queryByLabelText("Aprovação do creator")).not.toBeInTheDocument();
    });
  });
});
