// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
vi.mock("@/hooks/use-opportunity", () => ({ useOpportunity: () => ({ data: { creatorId: "c1" } }) }));
vi.mock("@/hooks/use-proposal-blocks", () => ({
  useProposalBlocks: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/use-proposal-items", () => ({
  useProposalItems: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/components/proposals/proposal-items-table", () => ({ ProposalItemsTable: () => null }));
vi.mock("@/components/proposals/proposal-cover-section", () => ({ ProposalCoverSection: () => null }));
vi.mock("@/components/proposals/proposal-text-section", () => ({ ProposalTextSection: () => null }));

import ProposalPage from "./page";

describe("ProposalPage (builder)", () => {
  it("links to the preview", async () => {
    await act(async () => {
      render(
        <React.Suspense fallback={null}>
          <ProposalPage params={Promise.resolve({ id: "p1" })} />
        </React.Suspense>,
      );
    });
    expect(await screen.findByRole("link", { name: "Pré-visualizar" })).toHaveAttribute("href", "/proposals/p1/preview");
  });

  it("saves the theme through the Tema select", async () => {
    await act(async () => {
      render(
        <React.Suspense fallback={null}>
          <ProposalPage params={Promise.resolve({ id: "p1" })} />
        </React.Suspense>,
      );
    });
    await userEvent.click(await screen.findByRole("combobox", { name: "Tema" }));
    await userEvent.click(screen.getByRole("option", { name: "Editorial" }));
    expect(mutateMock).toHaveBeenCalledWith({ theme: "EDITORIAL" });
  });
});
