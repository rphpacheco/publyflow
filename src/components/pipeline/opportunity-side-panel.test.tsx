// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OpportunitySidePanel } from "./opportunity-side-panel";
import type { OpportunityListItem } from "@/hooks/use-opportunities";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const opportunity: OpportunityListItem = {
  id: "o1",
  organizationId: "org1",
  creatorId: "creator1",
  leadId: "lead1",
  companyId: "c1",
  brandId: null,
  stage: "NOVO_LEAD",
  status: "OPEN",
  estimatedValueCents: 250000,
  createdAt: new Date().toISOString(),
  companyName: "Bella Cosméticos",
  brandName: null,
  contactName: "Maria",
};

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("OpportunitySidePanel", () => {
  beforeEach(() => {
    // no-op: this component no longer reads a dev user/org id.
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    pushMock.mockClear();
  });

  it("renders null when there's no opportunity", () => {
    const { container } = renderWithClient(
      <OpportunitySidePanel opportunity={null} open={false} onOpenChange={() => {}} onMoveToStage={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the opportunity's data and changes stage via the Select", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }));
    const user = userEvent.setup();
    const onMoveToStage = vi.fn();

    renderWithClient(
      <OpportunitySidePanel
        opportunity={opportunity}
        open
        onOpenChange={() => {}}
        onMoveToStage={onMoveToStage}
      />,
    );

    expect(screen.getByText("Bella Cosméticos")).toBeInTheDocument();
    expect(screen.getByText("R$ 2.500,00")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Stage" }));
    await user.click(await screen.findByRole("option", { name: "Qualificação" }));

    expect(onMoveToStage).toHaveBeenCalledWith("o1", "QUALIFICACAO");
  });

  it("lists existing proposals with a status badge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "p1",
            organizationId: "org1",
            opportunityId: "o1",
            title: "Campanha Verão",
            template: "PREMIUM",
            status: "DRAFT",
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    );

    renderWithClient(
      <OpportunitySidePanel opportunity={opportunity} open onOpenChange={() => {}} onMoveToStage={() => {}} />,
    );

    expect(await screen.findByText("Campanha Verão")).toBeInTheDocument();
    expect(screen.getByText("Rascunho")).toBeInTheDocument();

    const requestedUrl = (vi.mocked(fetch).mock.calls[0]![0] as string) ?? "";
    expect(requestedUrl).not.toContain("organizationId");
  });

  it("creates a new proposal via the dialog", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith("/api/proposals?")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      }
      return Promise.resolve({
        ok: true,
        status: 201,
        json: async () => ({
          id: "p2",
          organizationId: "org1",
          opportunityId: "o1",
          title: "Nova Campanha",
          template: "PREMIUM",
          status: "DRAFT",
          createdAt: new Date().toISOString(),
        }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderWithClient(
      <OpportunitySidePanel opportunity={opportunity} open onOpenChange={() => {}} onMoveToStage={() => {}} />,
    );

    await user.click(screen.getByRole("button", { name: "Nova Proposta" }));
    await user.type(screen.getByLabelText("Título"), "Nova Campanha");
    await user.click(screen.getByRole("combobox", { name: "Template" }));
    await user.click(await screen.findByRole("option", { name: "Premium" }));
    await user.click(screen.getByRole("button", { name: "Criar" }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeDefined();
    });

    const postCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    )!;
    const parsedBody = JSON.parse((postCall[1] as RequestInit).body as string);
    expect(parsedBody).toEqual({
      opportunityId: "o1",
      title: "Nova Campanha",
      template: "PREMIUM",
    });
    expect(parsedBody).not.toHaveProperty("organizationId");
    expect(parsedBody).not.toHaveProperty("userId");

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/proposals/p2");
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Nova Proposta" })).not.toBeInTheDocument();
    });
  });
});
