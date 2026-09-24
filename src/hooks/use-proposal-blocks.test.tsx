// src/hooks/use-proposal-blocks.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useProposalBlocks, useUpdateProposalBlock } from "./use-proposal-blocks";

afterEach(() => {
  vi.unstubAllGlobals();
});

function ListProbe() {
  const { data, isLoading } = useProposalBlocks("org1", "p1");
  if (isLoading) return <span>loading</span>;
  return <span>{data?.length ?? 0} blocks</span>;
}

describe("useProposalBlocks", () => {
  it("fetches blocks for a proposal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: "b1", blockType: "COVER", content: { headline: "" } }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ListProbe />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("1 blocks")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/proposals/p1/blocks?organizationId=org1");
  });
});

function UpdateProbe() {
  const update = useUpdateProposalBlock("org1", "p1", "user1");
  return (
    <button onClick={() => update.mutate({ blockId: "b1", content: { headline: "Nova capa" } })}>
      Salvar
    </button>
  );
}

describe("useUpdateProposalBlock", () => {
  it("PATCHes the block with organizationId/proposalId/userId injected", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "b1", blockType: "COVER", content: { headline: "Nova capa" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <UpdateProbe />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/proposal-blocks/b1");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      proposalId: "p1",
      userId: "user1",
      content: { headline: "Nova capa" },
    });
  });
});
