// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PipelineCard } from "./pipeline-card";
import { STAGE_LABELS } from "@/lib/opportunity-stages";

describe("PipelineCard", () => {
  it("shows header and linked bars", () => {
    const stages = Object.keys(STAGE_LABELS).slice(0, 2) as Array<keyof typeof STAGE_LABELS>;
    const { container } = render(<PipelineCard openNow={{ count: 3, valueCents: 200000 }} funnel={[{ stage: stages[0], count: 2 }, { stage: stages[1], count: 1 }]} />);
    expect(container.textContent).toMatch(/3 abertas · R\$\s2\.000,00 em negociação/);
    for (const [i, s] of stages.entries()) {
      const link = screen.getByText(STAGE_LABELS[s]).closest("a");
      expect(link?.getAttribute("href")).toBe("/pipeline");
      expect(link?.textContent).toContain(String(2 - i));
    }
    expect(container.querySelectorAll("a").length).toBe(2);
  });
});
