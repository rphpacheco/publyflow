// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiCard } from "./kpi-card";

describe("KpiCard", () => {
  it("shows value, context and a good delta with an icon, no glyphs", () => {
    const { container } = render(<KpiCard label="Fechado" value="R$ 84.500,00" context="7 oportunidades" delta={{ label: "18%", direction: "up", tone: "good" }} />);
    expect(screen.getByText("R$ 84.500,00")).toBeTruthy();
    expect(screen.getByText("7 oportunidades")).toBeTruthy();
    const delta = screen.getByTestId("kpi-delta");
    expect(delta.textContent).toContain("18%");
    expect(delta.getAttribute("data-tone")).toBe("good");
    expect(delta.querySelector("svg")).toBeTruthy();
    expect(container.textContent).not.toMatch(/[▲▼✓📅]/u);
  });
  it("shows a dash when there is no comparison", () => {
    render(<KpiCard label="Taxa" value="—" delta={{ label: null, direction: null, tone: "neutral" }} />);
    expect(screen.getByTestId("kpi-delta").textContent).toContain("—");
  });
});
