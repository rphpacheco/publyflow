// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import type { CommercialInquiryListItem } from "@/hooks/use-commercial-inquiries";
import { InquirySidePanel } from "./inquiry-side-panel";

afterEach(() => {
  vi.unstubAllGlobals();
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
        organizationId="org1"
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
});
