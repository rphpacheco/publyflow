// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { requestPasswordReset } = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(async (): Promise<{ sent: boolean; error: string | null }> => ({ sent: true, error: null })),
}));
vi.mock("./actions", () => ({ requestPasswordReset }));

import { ForgotPasswordForm } from "./forgot-password-form";

describe("ForgotPasswordForm", () => {
  it("renders the field, button and back link", () => {
    render(<ForgotPasswordForm />);
    expect(screen.getByLabelText("E-mail")).toHaveAttribute("type", "email");
    expect(screen.getByRole("button", { name: "Enviar link" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Voltar ao login" })).toHaveAttribute("href", "/login");
  });

  it("shows the neutral confirmation after sending", async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText("E-mail"), "a@b.com");
    await user.click(screen.getByRole("button", { name: "Enviar link" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Se houver acesso para este e-mail, enviamos um link para definir a senha.",
    );
    expect(screen.getByRole("link", { name: "Voltar ao login" })).toBeInTheDocument();
  });

  it("shows the error under the input", async () => {
    requestPasswordReset.mockResolvedValueOnce({ sent: false, error: "Muitas tentativas. Tente novamente em alguns minutos." });
    const user = userEvent.setup();
    render(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText("E-mail"), "a@b.com");
    await user.click(screen.getByRole("button", { name: "Enviar link" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Muitas tentativas");
    expect(screen.getByLabelText("E-mail")).toHaveAttribute("aria-describedby", alert.id);
  });
});
