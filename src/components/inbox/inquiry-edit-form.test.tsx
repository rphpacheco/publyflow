// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InquiryEditForm } from "./inquiry-edit-form";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/companies")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [
            { id: "c1", organizationId: "org1", name: "Bella Cosméticos Ltda", createdAt: "2026-01-01" },
            { id: "c2", organizationId: "org1", name: "Bella Cosméticos ME", createdAt: "2026-01-01" },
          ],
        });
      }
      if (url.includes("/api/brands")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [
            { id: "b1", organizationId: "org1", name: "Bella Skincare", createdAt: "2026-01-01" },
            { id: "b2", organizationId: "org1", name: "Bella Makeup", createdAt: "2026-01-01" },
          ],
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => [] });
    }),
  );
}

function renderForm(onConfirm = vi.fn()) {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <InquiryEditForm
        organizationId="org1"
        initialCompanyName="Bella Cosméticos"
        initialContactName="Maria"
        onConfirm={onConfirm}
      />
    </QueryClientProvider>,
  );
  return { onConfirm };
}

describe("InquiryEditForm", () => {
  it("disables Confirmar until both company and brand have an explicit choice", async () => {
    const user = userEvent.setup();
    stubFetch();
    renderForm();

    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Sem empresa" }));
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Sem marca" }));
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeEnabled();
  });

  it("lets the assessora pick an existing company from the Combobox and confirms with its id", async () => {
    const user = userEvent.setup();
    stubFetch();
    const { onConfirm } = renderForm();

    const companyCombobox = await screen.findByRole("combobox", { name: /empresa/i });
    await user.click(companyCombobox);
    const option = await screen.findByText("Bella Cosméticos Ltda");
    await user.click(option);

    await user.click(screen.getByRole("button", { name: "Sem marca" }));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "c1", brandId: null }),
    );
  });

  it("shows a Brand combobox that resolves an ambiguous brand guess", async () => {
    const user = userEvent.setup();
    stubFetch();
    const { onConfirm } = renderForm();

    await user.click(screen.getByRole("button", { name: "Sem empresa" }));

    const brandCombobox = await screen.findByRole("combobox", { name: /marca/i });
    await user.click(brandCombobox);
    const option = await screen.findByText("Bella Skincare");
    await user.click(option);

    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: null, brandId: "b1" }),
    );
  });

  it("selecting 'Sem empresa' and 'Sem marca' then confirming sends companyId: null, brandId: null", async () => {
    const user = userEvent.setup();
    stubFetch();
    const { onConfirm } = renderForm();

    await user.click(screen.getByRole("button", { name: "Sem empresa" }));
    await user.click(screen.getByRole("button", { name: "Sem marca" }));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: null, brandId: null }),
    );
  });

  it("does not offer 'criar nova empresa' since there is no backend support for creating companies", async () => {
    const user = userEvent.setup();
    stubFetch();
    renderForm();

    const companyCombobox = await screen.findByRole("combobox", { name: /empresa/i });
    await user.click(companyCombobox);
    await user.type(screen.getByPlaceholderText("Buscar..."), "Empresa Nova Que Não Existe");

    expect(screen.queryByText(/Criar "/)).not.toBeInTheDocument();
  });

  it("does not show the AI guess as a pre-filled combobox value (placeholder is generic)", async () => {
    stubFetch();
    renderForm();

    const companyCombobox = await screen.findByRole("combobox", { name: /empresa/i });
    expect(companyCombobox).toHaveTextContent("Buscar empresa...");
    expect(await screen.findByText(/A IA sugeriu: Bella Cosméticos/)).toBeInTheDocument();
  });
});
