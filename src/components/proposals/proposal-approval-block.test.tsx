// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SendStateApprovalDto } from "@/hooks/use-proposal-sending";

let approvePending = false;
let requestChangesPending = false;
const approveMutateMock = vi.fn();
const requestChangesMutateMock = vi.fn();

vi.mock("@/hooks/use-proposal-sending", () => ({
  useApproveProposal: () => ({ mutate: approveMutateMock, isPending: approvePending }),
  useRequestProposalChanges: () => ({ mutate: requestChangesMutateMock, isPending: requestChangesPending }),
}));

import { ProposalApprovalBlock } from "./proposal-approval-block";

const pending: SendStateApprovalDto = {
  state: "pending",
  required: true,
  creatorName: "Creator Teste",
  current: {
    id: "req1",
    versionNumber: 2,
    requestedAt: "2026-09-29T12:00:00.000Z",
    requestedByName: "Owner",
    decision: null,
    decidedAt: null,
    message: null,
  },
};

describe("ProposalApprovalBlock", () => {
  beforeEach(() => {
    approveMutateMock.mockReset();
    requestChangesMutateMock.mockReset();
    approvePending = false;
    requestChangesPending = false;
  });

  it("renders nothing when approval is not required", () => {
    const approval: SendStateApprovalDto = { state: "not_required", required: false, creatorName: null, current: null };
    const { container } = render(<ProposalApprovalBlock proposalId="p1" approval={approval} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when state is none", () => {
    const approval: SendStateApprovalDto = { state: "none", required: true, creatorName: "Creator Teste", current: null };
    const { container } = render(<ProposalApprovalBlock proposalId="p1" approval={approval} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when state is not_required", () => {
    const approval: SendStateApprovalDto = { state: "not_required", required: true, creatorName: "Creator Teste", current: null };
    const { container } = render(<ProposalApprovalBlock proposalId="p1" approval={approval} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("pending: shows the request message and both action buttons", () => {
    render(<ProposalApprovalBlock proposalId="p1" approval={pending} />);
    expect(screen.getByText("Owner pediu sua aprovação desta versão.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprovar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pedir ajustes" })).toBeInTheDocument();
  });

  it("Aprovar opens a confirmation dialog and confirming calls approve.mutate({})", async () => {
    render(<ProposalApprovalBlock proposalId="p1" approval={pending} />);

    await userEvent.click(screen.getByRole("button", { name: "Aprovar" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Aprovar proposta")).toBeInTheDocument();
    expect(within(dialog).getByText("A agência poderá enviar esta versão ao cliente.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Aprovar" }));

    expect(approveMutateMock).toHaveBeenCalledWith({ approvalId: "req1" });
  });

  it("Pedir ajustes opens a dialog with a labelled textarea; submit disabled until text is entered", async () => {
    render(<ProposalApprovalBlock proposalId="p1" approval={pending} />);

    await userEvent.click(screen.getByRole("button", { name: "Pedir ajustes" }));

    const textarea = await screen.findByLabelText("O que precisa mudar?");
    const submit = screen.getByRole("button", { name: "Enviar pedido" });
    expect(submit).toBeDisabled();

    await userEvent.type(textarea, "Trocar a capa");
    expect(submit).toBeEnabled();

    await userEvent.click(submit);

    expect(requestChangesMutateMock).toHaveBeenCalledWith({ approvalId: "req1", message: "Trocar a capa" }, expect.anything());
  });

  it("Pedir ajustes: submit stays disabled for whitespace-only text", async () => {
    render(<ProposalApprovalBlock proposalId="p1" approval={pending} />);

    await userEvent.click(screen.getByRole("button", { name: "Pedir ajustes" }));

    const textarea = await screen.findByLabelText("O que precisa mudar?");
    await userEvent.type(textarea, "   ");

    expect(screen.getByRole("button", { name: "Enviar pedido" })).toBeDisabled();
  });

  it("approved: shows the decision date", () => {
    const approval: SendStateApprovalDto = {
      state: "approved",
      required: true,
      creatorName: "Creator Teste",
      current: {
        id: "req1",
        versionNumber: 2,
        requestedAt: "2026-09-29T12:00:00.000Z",
        requestedByName: "Owner",
        decision: "APPROVED",
        decidedAt: "2026-09-29T15:30:00.000Z",
        message: null,
      },
    };
    render(<ProposalApprovalBlock proposalId="p1" approval={approval} />);
    expect(screen.getByText(/^Você aprovou esta versão em/)).toBeInTheDocument();
  });

  it("changes_requested: shows the date and the message", () => {
    const approval: SendStateApprovalDto = {
      state: "changes_requested",
      required: true,
      creatorName: "Creator Teste",
      current: {
        id: "req1",
        versionNumber: 2,
        requestedAt: "2026-09-29T12:00:00.000Z",
        requestedByName: "Owner",
        decision: "CHANGES_REQUESTED",
        decidedAt: "2026-09-29T15:30:00.000Z",
        message: "Trocar a capa",
      },
    };
    render(<ProposalApprovalBlock proposalId="p1" approval={approval} />);
    expect(screen.getByText(/^Você pediu ajustes em .*:$/)).toBeInTheDocument();
    expect(screen.getByText("Trocar a capa")).toBeInTheDocument();
  });

  it("stale: shows the wait-for-new-request copy", () => {
    const approval: SendStateApprovalDto = {
      state: "stale",
      required: true,
      creatorName: "Creator Teste",
      current: {
        id: "req1",
        versionNumber: 2,
        requestedAt: "2026-09-29T12:00:00.000Z",
        requestedByName: "Owner",
        decision: null,
        decidedAt: null,
        message: null,
      },
    };
    render(<ProposalApprovalBlock proposalId="p1" approval={approval} />);
    expect(screen.getByText("A proposta mudou depois do pedido. Aguarde um novo pedido da agência.")).toBeInTheDocument();
  });

  it("pending + sentWithoutApproval: shows the sent-without-approval notice instead of the action buttons", () => {
    render(<ProposalApprovalBlock proposalId="p1" approval={pending} sentWithoutApproval />);
    expect(screen.getByText("A agência enviou esta versão sem a sua aprovação.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aprovar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pedir ajustes" })).not.toBeInTheDocument();
    expect(screen.queryByText("Owner pediu sua aprovação desta versão.")).not.toBeInTheDocument();
  });

  it("pending without sentWithoutApproval: still shows the normal request copy and buttons", () => {
    render(<ProposalApprovalBlock proposalId="p1" approval={pending} sentWithoutApproval={false} />);
    expect(screen.getByText("Owner pediu sua aprovação desta versão.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprovar" })).toBeInTheDocument();
  });

  it("disables the action buttons while approve is pending", () => {
    approvePending = true;
    render(<ProposalApprovalBlock proposalId="p1" approval={pending} />);
    expect(screen.getByRole("button", { name: "Aprovar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pedir ajustes" })).toBeDisabled();
  });

  it("disables the action buttons while request-changes is pending", () => {
    requestChangesPending = true;
    render(<ProposalApprovalBlock proposalId="p1" approval={pending} />);
    expect(screen.getByRole("button", { name: "Aprovar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pedir ajustes" })).toBeDisabled();
  });
});
