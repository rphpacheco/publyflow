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

  // The sign-out form lives OUTSIDE the menu content: Radix unmounts the
  // content when an item is selected, which in real browsers cancelled the
  // submit of a form nested in the menu (logout did nothing).
  function signOutForm(container: HTMLElement): HTMLFormElement {
    const form = container.querySelector<HTMLFormElement>('form[action="/auth/signout"]');
    expect(form).not.toBeNull();
    return form!;
  }

  it("keeps a POST form to /auth/signout outside the menu content", async () => {
    const { container } = render(<AccountMenu />);
    const form = signOutForm(container);
    expect(form.method).toBe("post");
    await userEvent.click(screen.getByRole("button", { name: "Conta" }));
    expect(screen.getByRole("menuitem", { name: "Sair" }).closest("form")).toBeNull();
  });

  it.each([
    ["mouse", async () => userEvent.click(screen.getByRole("menuitem", { name: "Sair" }))],
    [
      "keyboard",
      async () => {
        screen.getByRole("menuitem", { name: "Sair" }).focus();
        await userEvent.keyboard("{Enter}");
      },
    ],
  ])("selecting Sair with the %s submits the sign-out form", async (_how, select) => {
    const { container } = render(<AccountMenu />);
    const form = signOutForm(container);
    const submit = vi.fn((e: Event) => e.preventDefault());
    form.addEventListener("submit", submit);
    await userEvent.click(screen.getByRole("button", { name: "Conta" }));
    await select();
    expect(submit).toHaveBeenCalledTimes(1);
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

  it("keeps the item disabled while pending, then closes the menu", async () => {
    let resolve!: (v: { ok: true; email: string }) => void;
    actionMock.mockReturnValue(new Promise((r) => (resolve = r)));
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Alterar senha" }));
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Alterar senha" })).toHaveAttribute("aria-disabled", "true"));
    resolve({ ok: true, email: "ana@brand.com" });
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "Alterar senha" })).toBeNull());
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
