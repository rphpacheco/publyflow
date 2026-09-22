// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./button";

describe("Button", () => {
  it("renders its label and applies the primary variant by default", () => {
    render(<Button>Nova Proposta</Button>);
    const button = screen.getByRole("button", { name: "Nova Proposta" });
    expect(button).toBeInTheDocument();
    expect(button.className).toContain("bg-primary");
  });

  it("renders as the wrapped element when asChild is used", () => {
    render(
      <Button asChild>
        <a href="/inbox">Ir para Inbox</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Ir para Inbox" });
    expect(link).toBeInTheDocument();
    expect(link.className).toContain("bg-primary");
  });

  it("respects the disabled attribute", () => {
    render(<Button disabled>Indisponível</Button>);
    expect(screen.getByRole("button", { name: "Indisponível" })).toBeDisabled();
  });
});
