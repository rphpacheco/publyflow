// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import type { CommercialInquiryListItem } from "@/hooks/use-commercial-inquiries";
import { InquirySidePanel } from "./inquiry-side-panel";

afterEach(() => {
  vi.unstubAllGlobals();
  toast.dismiss();
});

const inquiry: CommercialInquiryListItem = {
  id: "i1",
  organizationId: "org1",
  creatorId: "creator1",
  messageId: "m1",
  status: "NEW",
  companyGuess: "Bella Cosméticos",
  brandGuess: null,
  contactNameGuess: "Maria",
  budgetGuess: null,
  intentGuess: "Pedido de mídia kit",
  convertedLeadId: null,
  linkedOpportunityId: null,
  createdAt: "2026-01-01T12:00:00.000Z",
  messageBody: "Olá, gostaríamos de saber os valores.",
  messageReceivedAt: "2026-01-01T12:00:00.000Z",
  externalContactLabel: "Maria — Bella Cosméticos",
  source: "INSTAGRAM",
  conversationId: "conv1",
};

function renderPanel(onOpenChange = vi.fn()) {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <InquirySidePanel
        inquiry={inquiry}
        open
        onOpenChange={onOpenChange}
        creatorId="creator1"
        status="NEW"
      />
      <Toaster />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

describe("InquirySidePanel", () => {
  it("shows the full message and discards the inquiry on click, then closes", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 204 }));
    const { onOpenChange } = renderPanel();

    expect(screen.getByText("Olá, gostaríamos de saber os valores.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Descartar" }));

    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(await screen.findByText(/Descartada/)).toBeInTheDocument();
  });

  it("shows a clear message (not a generic error) when convert fails with 422", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        json: async () => ({ error: "Multiple companies match" }),
      }),
    );
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Converter em Opportunity" }));

    expect(
      await screen.findByText(/Mais de uma empresa encontrada com esse nome/),
    ).toBeInTheDocument();
  });

  it("falls back to the edit form automatically when convert returns 422, and confirming it retries with the resolved company and brand", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/convert") && init) {
        const body = JSON.parse(init.body as string);
        if (body.companyId === "c1") {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ inquiry: {}, lead: {}, opportunity: {} }) });
        }
        return Promise.resolve({
          ok: false,
          status: 422,
          statusText: "Unprocessable Entity",
          json: async () => ({ error: "Multiple companies match" }),
        });
      }
      if (url.includes("/api/companies")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [{ id: "c1", organizationId: "org1", name: "Bella Cosméticos Ltda", createdAt: "2026-01-01" }],
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();

    await user.click(screen.getByRole("button", { name: "Converter em Opportunity" }));
    expect(await screen.findByText(/Mais de uma empresa encontrada/)).toBeInTheDocument();

    const companyCombobox = await screen.findByRole("combobox", { name: /empresa/i });
    await user.click(companyCombobox);
    await user.click(await screen.findByText("Bella Cosméticos Ltda"));
    await user.click(screen.getByRole("button", { name: "Sem marca" }));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByText("Convertida em Opportunity")).toBeInTheDocument();
  });

  it("keeps edit mode open with an actionable message when the retried convert also fails", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/convert") && init) {
        return Promise.resolve({
          ok: false,
          status: 422,
          statusText: "Unprocessable Entity",
          json: async () => ({ error: "Multiple companies match" }),
        });
      }
      if (url.includes("/api/companies")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [{ id: "c1", organizationId: "org1", name: "Bella Cosméticos Ltda", createdAt: "2026-01-01" }],
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel();

    await user.click(screen.getByRole("button", { name: "Converter em Opportunity" }));
    expect(await screen.findByText(/Mais de uma empresa encontrada/)).toBeInTheDocument();

    const companyCombobox = await screen.findByRole("combobox", { name: /empresa/i });
    await user.click(companyCombobox);
    await user.click(await screen.findByText("Bella Cosméticos Ltda"));
    await user.click(screen.getByRole("button", { name: "Sem marca" }));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(
      await screen.findByText(/Ainda não foi possível resolver — revise a seleção de empresa e marca abaixo\./),
    ).toBeInTheDocument();
    // Edit mode stays open: the combobox is still on screen, not the default action buttons.
    expect(screen.getByRole("combobox", { name: /empresa/i })).toBeInTheDocument();
  });
});
