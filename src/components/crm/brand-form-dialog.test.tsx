// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api-client";

const mutateAsync = vi.fn();
vi.mock("@/hooks/use-crm", () => ({
  useUpdateBrand: () => ({ mutateAsync, isPending: false }),
  useCompanies: () => ({ data: [{ id: "c1", name: "Bella" }] }),
}));

import { BrandFormDialog } from "./brand-form-dialog";

const brand = { id: "b1", name: "Linha", companyId: "c1" };

describe("BrandFormDialog", () => {
  beforeEach(() => mutateAsync.mockReset());

  it("submits the edited name with the company", async () => {
    mutateAsync.mockResolvedValue({ ...brand, name: "Linha Nova" });
    const onSaved = vi.fn();
    render(<BrandFormDialog open brand={brand} onOpenChange={() => {}} onSaved={onSaved} />);
    const input = screen.getByLabelText("Nome da brand");
    await userEvent.clear(input);
    await userEvent.type(input, "Linha Nova");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(mutateAsync).toHaveBeenCalledWith({ name: "Linha Nova", companyId: "c1" });
    expect(onSaved).toHaveBeenCalledWith({ ...brand, name: "Linha Nova" });
  });

  it("shows the 422 company error", async () => {
    mutateAsync.mockRejectedValueOnce(new ApiError(422, "Empresa selecionada não encontrada.", { code: "COMPANY_NOT_FOUND" }));
    render(<BrandFormDialog open brand={brand} onOpenChange={() => {}} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Empresa selecionada não encontrada.")).toBeTruthy();
  });
});
