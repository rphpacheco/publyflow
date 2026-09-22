// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "./input";

describe("Input", () => {
  it("accepts typed text and forwards standard input props", async () => {
    const user = userEvent.setup();
    render(<Input placeholder="Buscar..." />);
    const input = screen.getByPlaceholderText("Buscar...");
    await user.type(input, "Bella Cosméticos");
    expect(input).toHaveValue("Bella Cosméticos");
  });

  it("respects the disabled attribute", () => {
    render(<Input disabled placeholder="Indisponível" />);
    expect(screen.getByPlaceholderText("Indisponível")).toBeDisabled();
  });
});
