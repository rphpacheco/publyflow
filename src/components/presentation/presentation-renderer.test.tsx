// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PROPOSAL_THEMES } from "@/lib/proposal-themes";
import type { PresentationModel } from "@/lib/presentation/types";
import { PresentationRenderer } from "./presentation-renderer";

const model: PresentationModel = {
  theme: "MINIMAL",
  title: "Campanha Verão",
  headline: "Verão com Bella",
  body: "Uma campanha de lançamento.\n\nSegundo parágrafo.",
  creator: { name: "Thais", handle: "@thais" },
  clientName: "Bella Cosméticos",
  items: [
    { description: "Reel patrocinado", quantity: 3, unitPriceCents: 250000, subtotalCents: 750000, unitPriceLabel: "R$ 2.500,00", subtotalLabel: "R$ 7.500,00" },
    { description: "Stories", quantity: 2, unitPriceCents: 80000, subtotalCents: 160000, unitPriceLabel: "R$ 800,00", subtotalLabel: "R$ 1.600,00" },
  ],
  totalCents: 910000,
  totalLabel: "R$ 9.100,00",
  issuedAtLabel: "25 de setembro de 2026",
};

describe.each(PROPOSAL_THEMES)("PresentationRenderer — %s", (theme) => {
  it("renders headline, body, every item and the total", () => {
    render(<PresentationRenderer model={model} theme={theme} />);

    expect(screen.getByRole("heading", { level: 1, name: "Verão com Bella" })).toBeInTheDocument();
    expect(screen.getByText("Uma campanha de lançamento.")).toBeInTheDocument();
    expect(screen.getByText("Segundo parágrafo.")).toBeInTheDocument();
    expect(screen.getByText("Reel patrocinado")).toBeInTheDocument();
    expect(screen.getByText("Stories")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Total" })).getByText("R$ 9.100,00")).toBeInTheDocument();
    expect(document.querySelector(`[data-theme="${theme}"]`)).not.toBeNull();
  });

  it("hides items and total without items, and the text section without a body", () => {
    render(<PresentationRenderer model={{ ...model, items: [], totalCents: 0, totalLabel: "R$ 0,00", body: null }} theme={theme} />);

    expect(screen.queryByText("Reel patrocinado")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Total" })).not.toBeInTheDocument();
    expect(screen.queryByText("Uma campanha de lançamento.")).not.toBeInTheDocument();
    expect(screen.queryByText(/Adicione itens/)).not.toBeInTheDocument();
  });

  it("shows the three actions inert when no handler is given", async () => {
    render(<PresentationRenderer model={model} theme={theme} />);

    for (const label of ["Aceitar", "Pedir ajustes", "Recusar"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-disabled", "true");
    }
  });
});

describe("PresentationRenderer", () => {
  it("uses model.theme when no theme override is given", () => {
    render(<PresentationRenderer model={{ ...model, theme: "FASHION" }} />);
    expect(document.querySelector('[data-theme="FASHION"]')).not.toBeNull();
  });

  it("calls onAction with the action id when a handler is given", async () => {
    const onAction = vi.fn();
    render(<PresentationRenderer model={model} onAction={onAction} />);

    await userEvent.click(screen.getByRole("button", { name: "Pedir ajustes" }));
    expect(onAction).toHaveBeenCalledWith("request_changes");
    expect(screen.getByRole("button", { name: "Aceitar" })).not.toHaveAttribute("aria-disabled");
  });

  it("omits the client line when there is no client", () => {
    render(<PresentationRenderer model={{ ...model, clientName: null }} theme="PREMIUM" />);
    expect(screen.queryByText(/Bella Cosméticos/)).not.toBeInTheDocument();
  });

  it("merges an extra className onto the [data-theme] root", () => {
    render(<PresentationRenderer model={model} theme="PREMIUM" className="flex-1" />);
    expect(document.querySelector('[data-theme="PREMIUM"]')).toHaveClass("flex-1");
  });

  it("hideActions omits the action row entirely, even without a response", () => {
    render(<PresentationRenderer model={model} theme="PREMIUM" hideActions />);
    expect(screen.queryByRole("button", { name: "Aceitar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe.each(PROPOSAL_THEMES)("PresentationRenderer with a response — %s", (theme) => {
  it("shows the recorded result instead of the action buttons", () => {
    render(
      <PresentationRenderer
        model={model}
        theme={theme}
        response={{ action: "REQUEST_CHANGES", respondentName: "Maria", respondedAtLabel: "25 de setembro de 2026", message: "Trocar stories" }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Aceitar" })).not.toBeInTheDocument();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Ajustes solicitados por Maria em 25 de setembro de 2026.");
    expect(status).toHaveTextContent("Trocar stories");
  });
});

describe("PresentationRenderer response sentences", () => {
  it.each([
    ["ACCEPT", "Proposta aceita por Maria em 25 de setembro de 2026."],
    ["REJECT", "Proposta recusada por Maria em 25 de setembro de 2026."],
  ] as const)("%s", (action, sentence) => {
    render(
      <PresentationRenderer
        model={model}
        response={{ action, respondentName: "Maria", respondedAtLabel: "25 de setembro de 2026", message: null }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(sentence);
  });
});
