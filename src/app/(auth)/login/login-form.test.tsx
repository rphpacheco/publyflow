// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { loginWithPassword, loginWithGoogle, sendMagicLink } = vi.hoisted(() => ({
  loginWithPassword: vi.fn(async () => ({ error: null })),
  loginWithGoogle: vi.fn(async () => undefined),
  sendMagicLink: vi.fn(async () => ({ sent: true, error: null })),
}));

vi.mock("./actions", () => ({
  loginWithPassword,
  loginWithGoogle,
  sendMagicLink,
}));

import { LoginForm } from "./login-form";

describe("LoginForm", () => {
  it("shows the magic-link block with its heading and button", () => {
    render(<LoginForm oauthError={false} />);
    expect(screen.getByText("Entrar com link por e-mail")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar link" })).toBeInTheDocument();
  });

  it("shows the confirmation text after sendMagicLink resolves sent: true", async () => {
    const user = userEvent.setup();
    render(<LoginForm oauthError={false} />);

    await user.type(screen.getByLabelText("E-mail para o link"), "thais@example.com");
    await user.click(screen.getByRole("button", { name: "Enviar link" }));

    expect(
      await screen.findByText("Se houver acesso para este e-mail, enviamos um link. Confira sua caixa de entrada."),
    ).toBeInTheDocument();
  });
});
