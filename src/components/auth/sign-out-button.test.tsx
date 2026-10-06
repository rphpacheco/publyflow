// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SignOutButton } from "./sign-out-button";

describe("SignOutButton", () => {
  it("renders a POST form to /auth/signout with a submit button", () => {
    const { container } = render(<SignOutButton label="Sair" />);
    const form = container.querySelector("form");
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/auth/signout");
    expect(screen.getByRole("button", { name: "Sair" })).toHaveAttribute("type", "submit");
  });
});
