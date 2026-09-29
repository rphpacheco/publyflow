// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionRoleProvider } from "@/components/shell/session-role-context";

const mutateMock = vi.fn();
vi.mock("@/hooks/use-proposal", () => ({
  useProposal: () => ({
    data: { id: "p1", organizationId: "o1", opportunityId: "op1", title: "Campanha", theme: "MINIMAL", status: "DRAFT", createdAt: "" },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useUpdateProposal: () => ({ mutate: mutateMock, isPending: false }),
}));
const useOpportunityMock = vi.fn((..._args: unknown[]) => ({ data: { creatorId: "c1" } }));
vi.mock("@/hooks/use-opportunity", () => ({ useOpportunity: (...args: unknown[]) => useOpportunityMock(...args) }));
const useProposalBlocksMock = vi.fn((..._args: unknown[]) => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }));
vi.mock("@/hooks/use-proposal-blocks", () => ({
  useProposalBlocks: (...args: unknown[]) => useProposalBlocksMock(...args),
}));
const useProposalItemsMock = vi.fn((..._args: unknown[]) => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }));
vi.mock("@/hooks/use-proposal-items", () => ({
  useProposalItems: (...args: unknown[]) => useProposalItemsMock(...args),
}));
vi.mock("@/components/proposals/proposal-items-table", () => ({ ProposalItemsTable: () => null }));
vi.mock("@/components/proposals/proposal-cover-section", () => ({ ProposalCoverSection: () => null }));
vi.mock("@/components/proposals/proposal-text-section", () => ({ ProposalTextSection: () => null }));
vi.mock("@/components/proposals/proposal-send-panel", () => ({ ProposalSendPanel: () => <div>send-panel</div> }));
vi.mock("@/components/proposals/proposal-send-history", () => ({ ProposalSendHistory: () => <div>send-history</div> }));
vi.mock("@/components/proposals/proposal-read-view", () => ({
  ProposalReadView: ({ proposalId }: { proposalId: string }) => <div>read-view:{proposalId}</div>,
}));

import ProposalPage from "./page";

describe("ProposalPage (builder)", () => {
  it("links to the preview", async () => {
    await act(async () => {
      render(
        <SessionRoleProvider role="OWNER">
          <React.Suspense fallback={null}>
            <ProposalPage params={Promise.resolve({ id: "p1" })} />
          </React.Suspense>
        </SessionRoleProvider>,
      );
    });
    expect(await screen.findByRole("link", { name: "Pré-visualizar" })).toHaveAttribute("href", "/proposals/p1/preview");
  });

  it("saves the theme through the Tema select", async () => {
    await act(async () => {
      render(
        <SessionRoleProvider role="OWNER">
          <React.Suspense fallback={null}>
            <ProposalPage params={Promise.resolve({ id: "p1" })} />
          </React.Suspense>
        </SessionRoleProvider>,
      );
    });
    await userEvent.click(await screen.findByRole("combobox", { name: "Tema" }));
    await userEvent.click(screen.getByRole("option", { name: "Editorial" }));
    expect(mutateMock).toHaveBeenCalledWith({ theme: "EDITORIAL" });
  });

  it("renders the send panel, send history and the status badge", async () => {
    await act(async () => {
      render(
        <SessionRoleProvider role="OWNER">
          <React.Suspense fallback={null}>
            <ProposalPage params={Promise.resolve({ id: "p1" })} />
          </React.Suspense>
        </SessionRoleProvider>,
      );
    });
    expect(await screen.findByText("send-panel")).toBeInTheDocument();
    expect(screen.getByText("send-history")).toBeInTheDocument();
    expect(screen.getByText("Rascunho")).toBeInTheDocument();
  });

  it("renders ProposalReadView instead of the editor under role=CREATOR", async () => {
    await act(async () => {
      render(
        <SessionRoleProvider role="CREATOR">
          <React.Suspense fallback={null}>
            <ProposalPage params={Promise.resolve({ id: "p1" })} />
          </React.Suspense>
        </SessionRoleProvider>,
      );
    });

    expect(await screen.findByText("read-view:p1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Arquivar" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Título da proposta")).not.toBeInTheDocument();
  });

  it("disables useOpportunity, useProposalBlocks and useProposalItems for CREATOR", async () => {
    useOpportunityMock.mockClear();
    useProposalBlocksMock.mockClear();
    useProposalItemsMock.mockClear();

    await act(async () => {
      render(
        <SessionRoleProvider role="CREATOR">
          <React.Suspense fallback={null}>
            <ProposalPage params={Promise.resolve({ id: "p1" })} />
          </React.Suspense>
        </SessionRoleProvider>,
      );
    });

    expect(useOpportunityMock).toHaveBeenCalledWith("op1", { enabled: false });
    expect(useProposalBlocksMock).toHaveBeenCalledWith("p1", { enabled: false });
    expect(useProposalItemsMock).toHaveBeenCalledWith("p1", { enabled: false });
  });
});
