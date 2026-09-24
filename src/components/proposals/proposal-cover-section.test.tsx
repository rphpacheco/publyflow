// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProposalCoverSection } from "./proposal-cover-section";
import type { ProposalBlock } from "@/hooks/use-proposal-blocks";

afterEach(() => {
  vi.unstubAllGlobals();
});

const block: ProposalBlock = {
  id: "b1",
  organizationId: "org1",
  proposalId: "p1",
  blockType: "COVER",
  content: { headline: "Campanha Verão" },
  sortOrder: 0,
  createdAt: new Date().toISOString(),
};

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("ProposalCoverSection", () => {
  it("shows the current headline and saves on blur when changed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...block, content: { headline: "Nova Capa" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderWithClient(
      <ProposalCoverSection organizationId="org1" proposalId="p1" userId="user1" block={block} readOnly={false} />,
    );

    const input = screen.getByLabelText("Capa");
    expect(input).toHaveValue("Campanha Verão");

    await user.clear(input);
    await user.type(input, "Nova Capa");
    await user.tab();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/proposal-blocks/b1");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      proposalId: "p1",
      userId: "user1",
      content: { headline: "Nova Capa" },
    });
  });

  it("does not save on blur when the value is unchanged", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderWithClient(
      <ProposalCoverSection organizationId="org1" proposalId="p1" userId="user1" block={block} readOnly={false} />,
    );

    await user.click(screen.getByLabelText("Capa"));
    await user.tab();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disables the input when readOnly", () => {
    renderWithClient(
      <ProposalCoverSection organizationId="org1" proposalId="p1" userId="user1" block={block} readOnly />,
    );
    expect(screen.getByLabelText("Capa")).toBeDisabled();
  });
});
