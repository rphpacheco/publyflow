// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./badge";

describe("Badge", () => {
  it("renders its label with the requested semantic variant", () => {
    render(<Badge variant="success">Ativo</Badge>);
    const badge = screen.getByText("Ativo");
    expect(badge.className).toContain("text-success");
  });

  it("defaults to the neutral variant", () => {
    render(<Badge>Rascunho</Badge>);
    const badge = screen.getByText("Rascunho");
    expect(badge.className).toContain("bg-muted");
  });
});
