// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionUnavailable } from "./session-unavailable";

const originalLocation = window.location;

describe("SessionUnavailable", () => {
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  it("explains the problem and offers a retry, without mentioning the auth provider", () => {
    const { container } = render(<SessionUnavailable />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não foi possível verificar sua sessão agora. Tente novamente em instantes.",
    );
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/supabase/i);
    expect(text).not.toMatch(/autentica/i);
  });

  it("reloads the page when retrying", async () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, reload } });
    render(<SessionUnavailable />);
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
