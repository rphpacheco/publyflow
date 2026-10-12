// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type State = { error: string | null; fieldErrors: { password?: string; confirm?: string }; code?: "expired" };
const { setNewPassword } = vi.hoisted(() => ({
  setNewPassword: vi.fn(async (): Promise<State> => ({ error: null, fieldErrors: {} })),
}));
vi.mock("./actions", () => ({ setNewPassword }));

import { ResetPasswordForm } from "./reset-password-form";

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Nova senha"), "12345678");
  await user.type(screen.getByLabelText("Confirmar senha"), "12345678");
  await user.click(screen.getByRole("button", { name: "Salvar senha" }));
}

describe("ResetPasswordForm", () => {
  it("renders the fields and button", () => {
    render(<ResetPasswordForm />);
    for (const label of ["Nova senha", "Confirmar senha"]) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute("type", "password");
      expect(input).toHaveAttribute("autocomplete", "new-password");
      expect(input).toHaveAttribute("minlength", "8");
      expect(input).toHaveAttribute("maxlength", "72");
      expect(input).toBeRequired();
    }
    expect(screen.getByRole("button", { name: "Salvar senha" })).toBeEnabled();
  });

  it("shows field errors under the inputs", async () => {
    setNewPassword.mockResolvedValueOnce({ error: null, fieldErrors: { confirm: "As senhas não conferem." } });
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    await submit(user);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("As senhas não conferem.");
    expect(screen.getByLabelText("Confirmar senha")).toHaveAttribute("aria-describedby", alert.id);
  });

  it("shows the top error", async () => {
    setNewPassword.mockResolvedValueOnce({ error: "A nova senha precisa ser diferente da atual.", fieldErrors: {} });
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    await submit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("A nova senha precisa ser diferente da atual.");
    expect(screen.queryByRole("link", { name: "Pedir novo link" })).not.toBeInTheDocument();
  });

  it("offers a new link when the error is the expired one", async () => {
    setNewPassword.mockResolvedValueOnce({
      error: "Este link expirou ou já foi usado. Peça um novo link.",
      fieldErrors: {},
      code: "expired",
    });
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    await submit(user);
    expect(await screen.findByRole("link", { name: "Pedir novo link" })).toHaveAttribute("href", "/forgot-password");
  });
});
