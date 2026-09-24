// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProposalItemsTable } from "./proposal-items-table";
import type { ProposalItem } from "@/hooks/use-proposal-items";

afterEach(() => {
  vi.unstubAllGlobals();
});

const items: ProposalItem[] = [
  {
    id: "i1",
    organizationId: "org1",
    proposalId: "p1",
    rateCardItemId: "rci1",
    description: "Reel patrocinado",
    quantity: 2,
    unitPrice: 150000,
    sortOrder: 0,
    createdAt: new Date().toISOString(),
  },
];

const catalogItems = [
  {
    id: "rci1",
    organizationId: "org1",
    rateCardId: "rc1",
    serviceId: "s1",
    price: 150000,
    unitDescription: "por post",
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    serviceName: "Reel patrocinado",
    rateCardName: "Tabela Padrão",
  },
  {
    id: "rci2",
    organizationId: "org1",
    rateCardId: "rc2",
    serviceId: "s1",
    price: 220000,
    unitDescription: "por post",
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    serviceName: "Reel patrocinado",
    rateCardName: "Tabela Especial",
  },
  {
    id: "rci3",
    organizationId: "org1",
    rateCardId: "rc1",
    serviceId: "s2",
    price: 80000,
    unitDescription: "por post",
    sortOrder: 1,
    createdAt: new Date().toISOString(),
    serviceName: "Stories",
    rateCardName: "Tabela Padrão",
  },
];

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("ProposalItemsTable", () => {
  it("shows an EmptyState when there are no items", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }));
    renderWithClient(
      <ProposalItemsTable organizationId="org1" proposalId="p1" userId="user1" items={[]} creatorId="creator1" readOnly={false} />,
    );
    expect(screen.getByText("Nenhum item ainda")).toBeInTheDocument();
  });

  it("renders items with a total footer", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => catalogItems }));
    renderWithClient(
      <ProposalItemsTable organizationId="org1" proposalId="p1" userId="user1" items={items} creatorId="creator1" readOnly={false} />,
    );
    expect(screen.getByText("Reel patrocinado")).toBeInTheDocument();
    // 2 * R$1.500,00 = R$3.000,00
    expect(screen.getByText("R$ 3.000,00")).toBeInTheDocument();
  });

  it("disambiguates catalog options with the rate card name only when the service name repeats", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => catalogItems }));
    const user = userEvent.setup();

    renderWithClient(
      <ProposalItemsTable organizationId="org1" proposalId="p1" userId="user1" items={[]} creatorId="creator1" readOnly={false} />,
    );

    await user.click(screen.getByRole("combobox", { name: "Adicionar item" }));

    // "Reel patrocinado" exists in two rate cards -> disambiguated.
    expect(await screen.findByText(/Reel patrocinado.*Tabela Padrão/)).toBeInTheDocument();
    expect(await screen.findByText(/Reel patrocinado.*Tabela Especial/)).toBeInTheDocument();
    // "Stories" is unique -> no rate card name appended.
    const storiesOption = screen.getByText(/^Stories/);
    expect(storiesOption.textContent).not.toContain("Tabela");
  });

  it("adds a catalog item on selection", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/rate-card-items")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => catalogItems });
      }
      return Promise.resolve({ ok: true, status: 201, json: async () => items[0] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderWithClient(
      <ProposalItemsTable organizationId="org1" proposalId="p1" userId="user1" items={[]} creatorId="creator1" readOnly={false} />,
    );

    await user.click(screen.getByRole("combobox", { name: "Adicionar item" }));
    await user.click(await screen.findByText(/^Stories/));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          (url as string).includes("/items") && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeDefined();
    });
    const [, init] = fetchMock.mock.calls.find(
      ([url, callInit]) =>
        (url as string).includes("/items") && (callInit as RequestInit | undefined)?.method === "POST",
    )!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      userId: "user1",
      rateCardItemId: "rci3",
    });
  });

  it("adds an ad-hoc item with a negative price via the form", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/rate-card-items")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      }
      return Promise.resolve({ ok: true, status: 201, json: async () => items[0] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderWithClient(
      <ProposalItemsTable organizationId="org1" proposalId="p1" userId="user1" items={[]} creatorId="creator1" readOnly={false} />,
    );

    await user.click(screen.getByRole("combobox", { name: "Adicionar item" }));
    await user.click(await screen.findByText("+ Item avulso"));

    await user.type(screen.getByLabelText("Descrição"), "Desconto negociado");
    await user.type(screen.getByLabelText("Preço (R$)"), "-200.00");
    await user.click(screen.getByRole("button", { name: "Adicionar" }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          (url as string).includes("/items") && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeDefined();
    });
    const [, init] = fetchMock.mock.calls.find(
      ([url, callInit]) =>
        (url as string).includes("/items") && (callInit as RequestInit | undefined)?.method === "POST",
    )!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      userId: "user1",
      description: "Desconto negociado",
      unitPrice: -20000,
    });
  });

  it("parses a BR-locale price with thousands separator ('1.500,00') as 150000 cents", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/rate-card-items")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      }
      return Promise.resolve({ ok: true, status: 201, json: async () => items[0] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderWithClient(
      <ProposalItemsTable organizationId="org1" proposalId="p1" userId="user1" items={[]} creatorId="creator1" readOnly={false} />,
    );

    await user.click(screen.getByRole("combobox", { name: "Adicionar item" }));
    await user.click(await screen.findByText("+ Item avulso"));

    await user.type(screen.getByLabelText("Descrição"), "Reel patrocinado");
    await user.type(screen.getByLabelText("Preço (R$)"), "1.500,00");
    await user.click(screen.getByRole("button", { name: "Adicionar" }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          (url as string).includes("/items") && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeDefined();
    });
    const [, init] = fetchMock.mock.calls.find(
      ([url, callInit]) =>
        (url as string).includes("/items") && (callInit as RequestInit | undefined)?.method === "POST",
    )!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      organizationId: "org1",
      userId: "user1",
      description: "Reel patrocinado",
      unitPrice: 150000,
    });
  });

  it("removes an item after confirming the AlertDialog", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/rate-card-items")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      }
      return Promise.resolve({ ok: true, status: 204, json: async () => undefined });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderWithClient(
      <ProposalItemsTable organizationId="org1" proposalId="p1" userId="user1" items={items} creatorId="creator1" readOnly={false} />,
    );

    await user.click(screen.getByRole("button", { name: "Remover Reel patrocinado" }));
    expect(await screen.findByText("Remover este item?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remover" }));

    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
      );
      expect(deleteCall).toBeDefined();
    });
  });

  it("does not render the combobox, ad-hoc form trigger, or remove button when readOnly", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }));
    renderWithClient(
      <ProposalItemsTable organizationId="org1" proposalId="p1" userId="user1" items={items} creatorId="creator1" readOnly />,
    );
    expect(screen.queryByRole("combobox", { name: "Adicionar item" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remover Reel patrocinado" })).not.toBeInTheDocument();
  });
});
