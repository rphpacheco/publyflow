// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PresentationModel } from "@/lib/presentation/types";

const mutateMock = vi.fn();
vi.mock("@/hooks/use-proposal", () => ({
  useUpdateProposal: () => ({ mutate: mutateMock, isPending: false }),
}));
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn() } }));
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { PreviewShell } from "./preview-shell";

const model: PresentationModel = {
  theme: "MINIMAL",
  title: "Campanha Verão",
  headline: "Verão com Bella",
  body: null,
  creator: { name: "Thais", handle: "@thais" },
  clientName: "Bella Cosméticos",
  items: [
    { description: "Reel patrocinado", quantity: 1, unitPriceCents: 250000, subtotalCents: 250000, unitPriceLabel: "R$ 2.500,00", subtotalLabel: "R$ 2.500,00" },
  ],
  totalCents: 250000,
  totalLabel: "R$ 2.500,00",
  issuedAtLabel: "25 de setembro de 2026",
};

function renderShell(overrides: Partial<React.ComponentProps<typeof PreviewShell>> = {}) {
  return render(
    <PreviewShell proposalId="p1" model={model} savedTheme="MINIMAL" status="DRAFT" initialTheme="MINIMAL" {...overrides} />,
  );
}

describe("PreviewShell", () => {
  beforeEach(() => {
    mutateMock.mockReset();
    toastSuccess.mockReset();
    refreshMock.mockReset();
    window.history.replaceState(null, "", "/proposals/p1/preview");
  });

  it("switches the rendered theme and the URL without calling the API", async () => {
    renderShell();

    await userEvent.click(screen.getByRole("button", { name: "Editorial" }));

    expect(document.querySelector('[data-theme="EDITORIAL"]')).not.toBeNull();
    expect(window.location.search).toBe("?theme=editorial");
    expect(mutateMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Editorial" })).toHaveAttribute("aria-pressed", "true");
  });

  it("marks the saved theme as current and removes the param when it is selected again", async () => {
    renderShell();

    await userEvent.click(screen.getByRole("button", { name: "Moda" }));
    await userEvent.click(screen.getByRole("button", { name: "Minimalista (atual)" }));

    expect(window.location.search).toBe("");
  });

  it("starts from the initial theme given by ?theme=", () => {
    renderShell({ initialTheme: "BEAUTY" });
    expect(document.querySelector('[data-theme="BEAUTY"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Aplicar este tema" })).toBeInTheDocument();
  });

  it("shows 'Aplicar este tema' only for a different theme on a non-archived proposal", async () => {
    renderShell();
    expect(screen.queryByRole("button", { name: "Aplicar este tema" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Premium" }));
    expect(screen.getByRole("button", { name: "Aplicar este tema" })).toBeInTheDocument();
  });

  it("never offers 'Aplicar este tema' for an archived proposal", async () => {
    renderShell({ status: "ARCHIVED" });
    await userEvent.click(screen.getByRole("button", { name: "Premium" }));
    expect(screen.queryByRole("button", { name: "Aplicar este tema" })).not.toBeInTheDocument();
  });

  it("applies the theme through the existing mutation and makes it current", async () => {
    mutateMock.mockImplementation((_input: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
    renderShell();

    await userEvent.click(screen.getByRole("button", { name: "Premium" }));
    await userEvent.click(screen.getByRole("button", { name: "Aplicar este tema" }));

    expect(mutateMock).toHaveBeenCalledWith({ theme: "PREMIUM" }, expect.anything());
    expect(toastSuccess).toHaveBeenCalledWith("Tema aplicado.");
    expect(refreshMock).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Premium (atual)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aplicar este tema" })).not.toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("renders the document inside a 390px frame in phone mode", async () => {
    renderShell();
    expect(screen.queryByTestId("mobile-frame")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Celular" }));

    const frame = screen.getByTestId("mobile-frame");
    expect(frame.className).toContain("w-[390px]");
    expect(frame.querySelector('[data-theme="MINIMAL"]')).not.toBeNull();
  });

  it("warns about missing items in the toolbar, never inside the document", () => {
    renderShell({ model: { ...model, items: [], totalCents: 0, totalLabel: "R$ 0,00" } });

    const warning = screen.getByText("Adicione itens para mostrar valores");
    expect(warning.closest('[data-theme]')).toBeNull();
    expect(warning.closest('header')).not.toBeNull();
  });

  it("links back to the editor", () => {
    renderShell();
    expect(screen.getByRole("link", { name: "Voltar ao editor" })).toHaveAttribute("href", "/proposals/p1");
  });

  it("CREATOR session: hides the editor link, the theme switcher and the inert client action row", () => {
    renderShell({ isCreator: true });
    expect(screen.queryByRole("link", { name: "Voltar ao editor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Tema" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aceitar" })).not.toBeInTheDocument();
  });
});
