// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api-client";

const mutateAsync = vi.fn();
vi.mock("@/hooks/use-crm", () => ({ useUpdateCompany: () => ({ mutateAsync, isPending: false }) }));

import { CompanyFormDialog } from "./company-form-dialog";

describe("CompanyFormDialog", () => {
  beforeEach(() => mutateAsync.mockReset());

  it("saves the new name", async () => {
    const onSaved = vi.fn();
    mutateAsync.mockResolvedValue({ id: "c1", name: "Bella Ltda" });
    render(<CompanyFormDialog open company={{ id: "c1", name: "Bella" }} onOpenChange={() => {}} onSaved={onSaved} />);
    const input = screen.getByLabelText("Nome da empresa");
    await userEvent.clear(input);
    await userEvent.type(input, "Bella Ltda");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(mutateAsync).toHaveBeenCalledWith({ name: "Bella Ltda" });
    expect(onSaved).toHaveBeenCalledWith({ id: "c1", name: "Bella Ltda" });
  });

  it("shows the 409 under the name field", async () => {
    mutateAsync.mockRejectedValueOnce(new ApiError(409, "Já existe uma empresa com esse nome.", { code: "COMPANY_NAME_TAKEN" }));
    render(<CompanyFormDialog open company={{ id: "c1", name: "Bella" }} onOpenChange={() => {}} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Já existe uma empresa com esse nome.")).toBeTruthy();
    expect(screen.getByLabelText("Nome da empresa").getAttribute("aria-invalid")).toBe("true");
  });
});
