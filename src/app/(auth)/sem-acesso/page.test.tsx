// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NoAccessPage from "./page";

describe("/sem-acesso", () => {
  it("offers a POST sign-out instead of a link to /login", () => {
    const { container } = render(<NoAccessPage />);
    expect(screen.getByRole("heading", { name: "Sua conta ainda não tem acesso" })).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Sair e entrar com outra conta" });
    const form = button.closest("form");
    expect(form).toHaveAttribute("action", "/auth/signout");
    expect(form).toHaveAttribute("method", "post");
    expect(container.querySelector('a[href="/login"]')).toBeNull();
  });
});
