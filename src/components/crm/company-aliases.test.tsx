// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mutateAsync = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("@/hooks/use-crm-merge", () => ({ useRemoveCompanyAlias: () => ({ mutateAsync, isPending: false }) }));

import { CompanyAliases } from "./company-aliases";

describe("CompanyAliases", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("renders nothing when there are no aliases", () => {
    const { container } = render(<CompanyAliases companyId="c1" aliases={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("lists the aliases with the help text and an icon remove button", () => {
    render(<CompanyAliases companyId="c1" aliases={[{ id: "a1", name: "Bella" }, { id: "a2", name: "Bella Ltda" }]} />);
    expect(screen.getByRole("heading", { name: "Apelidos" })).toBeTruthy();
    expect(screen.getByText("Nomes que a IA do Inbox reconhece como esta empresa.")).toBeTruthy();
    expect(screen.getByText("Bella Ltda")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Remover apelido Bella" });
    expect(button.querySelector("svg")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/[\p{Extended_Pictographic}←-⇿▲▼✓✔]/u);
  });

  it("removes after confirming and toasts", async () => {
    mutateAsync.mockResolvedValue(undefined);
    render(<CompanyAliases companyId="c1" aliases={[{ id: "a1", name: "Bella" }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remover apelido Bella" }));
    expect(mutateAsync).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Remover" }));
    expect(mutateAsync).toHaveBeenCalledWith({ aliasId: "a1" });
    expect(toastSuccess).toHaveBeenCalledWith("Apelido removido.");
  });

  it("does not remove when cancelled", async () => {
    render(<CompanyAliases companyId="c1" aliases={[{ id: "a1", name: "Bella" }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remover apelido Bella" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("toasts the error when the removal fails", async () => {
    mutateAsync.mockRejectedValue(new Error("boom"));
    render(<CompanyAliases companyId="c1" aliases={[{ id: "a1", name: "Bella" }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remover apelido Bella" }));
    await userEvent.click(screen.getByRole("button", { name: "Remover" }));
    expect(toastError).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
