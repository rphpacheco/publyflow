// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { check } = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("./grant-check", () => ({ hasValidResetGrant: check }));
vi.mock("./actions", () => ({ setNewPassword: vi.fn() }));

import ResetPasswordPage from "./page";

async function renderPage() {
  render(await ResetPasswordPage());
}

describe("ResetPasswordPage", () => {
  it("shows the form with a valid grant", async () => {
    check.mockResolvedValue("ok");
    await renderPage();
    expect(screen.getByRole("heading", { name: "Definir nova senha" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nova senha")).toBeInTheDocument();
  });

  it("shows the expired block with the new-link button", async () => {
    check.mockResolvedValue("expired");
    await renderPage();
    expect(screen.getByText("Este link expirou ou já foi usado. Peça um novo link.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pedir novo link" })).toHaveAttribute("href", "/forgot-password");
  });

  it("shows the unavailable screen on provider outage", async () => {
    check.mockResolvedValue("unavailable");
    await renderPage();
    expect(screen.getByText(/Não foi possível verificar sua sessão/)).toBeInTheDocument();
  });
});
