// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { actionMock, toastSuccess, toastError } = vi.hoisted(() => ({
  actionMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/app/(app)/account-actions", () => ({ requestPasswordChange: actionMock }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

import { AccountMenu } from "./account-menu";

async function open() {
  render(<AccountMenu />);
  await userEvent.click(screen.getByRole("button", { name: "Conta" }));
}

describe("AccountMenu", () => {
  beforeEach(() => {
    actionMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("shows the two items when opened", async () => {
    await open();
    expect(screen.getByRole("menuitem", { name: "Alterar senha" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Sair" })).toBeInTheDocument();
  });

  it("Sair lives inside a POST form to /auth/signout", async () => {
    await open();
    const form = screen.getByRole("menuitem", { name: "Sair" }).closest("form");
    expect(form).not.toBeNull();
    expect(form).toHaveAttribute("action", "/auth/signout");
    expect(form?.method).toBe("post");
  });

  it("Sair submits the form", async () => {
    await open();
    const form = screen.getByRole("menuitem", { name: "Sair" }).closest("form")!;
    const submit = vi.fn((e: Event) => e.preventDefault());
    form.addEventListener("submit", submit);
    await userEvent.click(screen.getByRole("menuitem", { name: "Sair" }));
    expect(submit).toHaveBeenCalled();
  });

  it("toasts success with the e-mail", async () => {
    actionMock.mockResolvedValue({ ok: true, email: "ana@brand.com" });
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Alterar senha" }));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "Enviamos um link para ana@brand.com. Abra-o para definir a nova senha.",
      ),
    );
  });

  it("toasts the error", async () => {
    actionMock.mockResolvedValue({ ok: false, error: "Muitas tentativas. Tente novamente em alguns minutos." });
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Alterar senha" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Muitas tentativas. Tente novamente em alguns minutos."),
    );
  });

  it("toasts the generic error when the action throws", async () => {
    actionMock.mockRejectedValue(new Error("boom"));
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Alterar senha" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Não foi possível enviar o link. Tente novamente."));
  });

  it("uses no glyphs in the copy", async () => {
    await open();
    expect(document.body.textContent).not.toMatch(/[✓✔▲▼📅]/u);
  });
});
