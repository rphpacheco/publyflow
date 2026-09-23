// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InquiryEditForm } from "./inquiry-edit-form";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InquiryEditForm", () => {
  it("lets the assessora pick an existing company from the Combobox and confirms with its id", async () => {
    const user = userEvent.setup();
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
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      }),
    );

    const onConfirm = vi.fn();
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

    const companyCombobox = await screen.findByRole("combobox", { name: /empresa/i });
    await user.click(companyCombobox);
    const option = await screen.findByText("Bella Cosméticos Ltda");
    await user.click(option);

    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "c1" }),
    );
  });
});
