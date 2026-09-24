// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useProposalItems,
  useAddProposalItem,
  useUpdateProposalItem,
  useRemoveProposalItem,
} from "./use-proposal-items";

afterEach(() => {
  vi.unstubAllGlobals();
});

function ListProbe() {
  const { data, isLoading } = useProposalItems("org1", "p1");
  if (isLoading) return <span>loading</span>;
  return <span>{data?.length ?? 0} items</span>;
}

describe("useProposalItems", () => {
  it("fetches items for a proposal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: "i1", description: "Reel", quantity: 1, unitPrice: 150000 }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ListProbe />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("1 items")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/proposals/p1/items?organizationId=org1");
  });
});

function AddCatalogProbe() {
  const add = useAddProposalItem("org1", "p1", "user1");
  return <button onClick={() => add.mutate({ rateCardItemId: "rci1" })}>Adicionar do catálogo</button>;
}

function AddAdHocProbe() {
  const add = useAddProposalItem("org1", "p1", "user1");
  return (
    <button onClick={() => add.mutate({ description: "Desconto", unitPrice: -20000 })}>
      Adicionar avulso
    </button>
  );
}

describe("useAddProposalItem", () => {
  it("POSTs a catalog item with rateCardItemId", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "i1", description: "Reel", quantity: 1, unitPrice: 150000 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AddCatalogProbe />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Adicionar do catálogo" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/proposals/p1/items");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      userId: "user1",
      rateCardItemId: "rci1",
    });
  });

  it("POSTs an ad-hoc item with a negative unitPrice (discount)", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "i2", description: "Desconto", quantity: 1, unitPrice: -20000 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <AddAdHocProbe />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Adicionar avulso" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      userId: "user1",
      description: "Desconto",
      unitPrice: -20000,
    });
  });
});

function UpdateProbe() {
  const update = useUpdateProposalItem("org1", "p1", "user1");
  return <button onClick={() => update.mutate({ itemId: "i1", quantity: 2 })}>Atualizar</button>;
}

describe("useUpdateProposalItem", () => {
  it("PATCHes the item with organizationId/proposalId/userId injected", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "i1", description: "Reel", quantity: 2, unitPrice: 150000 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <UpdateProbe />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/proposal-items/i1");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      proposalId: "p1",
      userId: "user1",
      quantity: 2,
    });
  });
});

function RemoveProbe() {
  const remove = useRemoveProposalItem("org1", "p1", "user1");
  return <button onClick={() => remove.mutate("i1")}>Remover</button>;
}

describe("useRemoveProposalItem", () => {
  it("DELETEs the item with organizationId/proposalId/userId in the body", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => undefined });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <RemoveProbe />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/proposal-items/i1");
    expect((init as RequestInit).method).toBe("DELETE");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      proposalId: "p1",
      userId: "user1",
    });
  });
});
