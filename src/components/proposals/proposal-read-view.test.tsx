// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Proposal } from "@/hooks/use-proposals";
import type { SendStateDto } from "@/hooks/use-proposal-sending";

const proposalState: { data: Proposal | undefined; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};
const sendState: { data: SendStateDto | undefined } = { data: undefined };

vi.mock("@/hooks/use-proposal", () => ({
  useProposal: () => ({ data: proposalState.data, isLoading: proposalState.isLoading, isError: proposalState.isError }),
}));
vi.mock("@/hooks/use-proposal-sending", () => ({
  useProposalSendState: () => ({ data: sendState.data }),
}));
vi.mock("@/components/proposals/proposal-send-history", () => ({
  ProposalSendHistory: ({ proposalId, status }: { proposalId: string; status: string }) => (
    <div>send-history:{proposalId}:{status}</div>
  ),
}));
vi.mock("@/components/proposals/proposal-share-actions", () => ({
  ProposalShareActions: ({ proposalId, publicPath }: { proposalId: string; publicPath: string }) => (
    <div>share-actions:{proposalId}:{publicPath}</div>
  ),
}));
vi.mock("@/components/proposals/proposal-approval-block", () => ({
  ProposalApprovalBlock: ({
    proposalId,
    approval,
    sentWithoutApproval,
  }: {
    proposalId: string;
    approval: SendStateDto["approval"];
    sentWithoutApproval?: boolean;
  }) => (
    <div>
      approval-block:{proposalId}:{approval.state}:{String(sentWithoutApproval ?? false)}
    </div>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ProposalReadView } from "./proposal-read-view";

const proposal: Proposal = {
  id: "p1",
  organizationId: "org1",
  opportunityId: "op1",
  title: "Campanha Verão",
  theme: "MINIMAL",
  status: "SENT",
  createdAt: new Date().toISOString(),
};

describe("ProposalReadView", () => {
  it("renders the title, status badge, preview iframe and send history", () => {
    proposalState.data = proposal;
    proposalState.isLoading = false;
    proposalState.isError = false;
    sendState.data = undefined;

    render(<ProposalReadView proposalId="p1" />);

    expect(screen.getByText("Campanha Verão")).toBeInTheDocument();
    expect(screen.getByText("Enviada")).toBeInTheDocument();

    const iframe = screen.getByTitle("Apresentação da proposta");
    expect(iframe).toHaveAttribute("src", "/proposals/p1/preview");

    expect(screen.getByText("send-history:p1:SENT")).toBeInTheDocument();
  });

  it("renders Copiar link, Abrir and share actions when a publicPath exists", () => {
    proposalState.data = proposal;
    proposalState.isLoading = false;
    proposalState.isError = false;
    sendState.data = {
      status: "SENT",
      publicPath: "/p/tok",
      latestPublication: null,
      latestVersionNumber: 1,
      hasUnsentChanges: false,
      canSend: true,
      approval: { state: "not_required", required: false, creatorName: "Thais", current: null },
    };

    render(<ProposalReadView proposalId="p1" />);

    expect(screen.getByRole("button", { name: "Copiar link" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir" })).toHaveAttribute("href", "/p/tok");
    expect(screen.getByText("share-actions:p1:/p/tok")).toBeInTheDocument();
  });

  it("renders the approval block when approval is required", () => {
    proposalState.data = proposal;
    proposalState.isLoading = false;
    proposalState.isError = false;
    sendState.data = {
      status: "SENT",
      publicPath: "/p/tok",
      latestPublication: null,
      latestVersionNumber: 1,
      hasUnsentChanges: false,
      canSend: true,
      approval: { state: "pending", required: true, creatorName: "Creator Teste", current: null },
    };

    render(<ProposalReadView proposalId="p1" />);

    expect(screen.getByText("approval-block:p1:pending:false")).toBeInTheDocument();
  });

  it("passes sentWithoutApproval:true when the latest publication matches the pending request's version and was sent without approval", () => {
    proposalState.data = proposal;
    proposalState.isLoading = false;
    proposalState.isError = false;
    sendState.data = {
      status: "SENT",
      publicPath: "/p/tok",
      latestPublication: {
        id: "pub1",
        versionNumber: 2,
        publishedAt: new Date().toISOString(),
        response: null,
        sentWithoutApproval: true,
      },
      latestVersionNumber: 2,
      hasUnsentChanges: false,
      canSend: true,
      approval: {
        state: "pending",
        required: true,
        creatorName: "Creator Teste",
        current: {
          id: "a1",
          versionNumber: 2,
          requestedAt: new Date().toISOString(),
          requestedByName: "Owner",
          decision: null,
          decidedAt: null,
          message: null,
        },
      },
    };

    render(<ProposalReadView proposalId="p1" />);

    expect(screen.getByText("approval-block:p1:pending:true")).toBeInTheDocument();
  });

  it("does not render the approval block when approval is not required", () => {
    proposalState.data = proposal;
    proposalState.isLoading = false;
    proposalState.isError = false;
    sendState.data = {
      status: "SENT",
      publicPath: "/p/tok",
      latestPublication: null,
      latestVersionNumber: 1,
      hasUnsentChanges: false,
      canSend: true,
      approval: { state: "not_required", required: false, creatorName: null, current: null },
    };

    render(<ProposalReadView proposalId="p1" />);

    expect(screen.queryByText(/^approval-block:/)).not.toBeInTheDocument();
  });

  it("reloads the preview iframe when the latest version changes (cache-busting query param)", () => {
    proposalState.data = proposal;
    proposalState.isLoading = false;
    proposalState.isError = false;
    sendState.data = {
      status: "SENT",
      publicPath: "/p/tok",
      latestPublication: null,
      latestVersionNumber: 1,
      hasUnsentChanges: false,
      canSend: true,
      approval: { state: "not_required", required: false, creatorName: null, current: null },
    };

    const { rerender } = render(<ProposalReadView proposalId="p1" />);
    expect(screen.getByTitle("Apresentação da proposta")).toHaveAttribute("src", "/proposals/p1/preview?v=1");

    sendState.data = { ...sendState.data, latestVersionNumber: 2 };
    rerender(<ProposalReadView proposalId="p1" />);
    expect(screen.getByTitle("Apresentação da proposta")).toHaveAttribute("src", "/proposals/p1/preview?v=2");
  });

  it("never renders send/resend controls", () => {
    proposalState.data = proposal;
    proposalState.isLoading = false;
    proposalState.isError = false;
    sendState.data = undefined;

    render(<ProposalReadView proposalId="p1" />);

    expect(screen.queryByRole("button", { name: "Enviar proposta" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reenviar" })).not.toBeInTheDocument();
  });

  it("shows a loading message while useProposal is loading", () => {
    proposalState.data = undefined;
    proposalState.isLoading = true;
    proposalState.isError = false;
    sendState.data = undefined;

    render(<ProposalReadView proposalId="p1" />);
    expect(screen.getByText("Carregando...")).toBeInTheDocument();
  });

  it("shows a not-found message on error", () => {
    proposalState.data = undefined;
    proposalState.isLoading = false;
    proposalState.isError = true;
    sendState.data = undefined;

    render(<ProposalReadView proposalId="p1" />);
    expect(screen.getByText("Proposta não encontrada.")).toBeInTheDocument();
  });
});
