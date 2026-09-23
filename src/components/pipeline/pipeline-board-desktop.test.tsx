// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DragEndEvent } from "@dnd-kit/core";
import { PipelineBoardDesktop, resolveDragEndStageChange } from "./pipeline-board-desktop";
import { STAGE_LABELS } from "@/lib/opportunity-stages";
import type { OpportunityListItem } from "@/hooks/use-opportunities";

const opportunity: OpportunityListItem = {
  id: "o1",
  organizationId: "org1",
  creatorId: "creator1",
  leadId: "lead1",
  companyId: null,
  brandId: null,
  stage: "QUALIFICACAO",
  status: "OPEN",
  estimatedValueCents: null,
  createdAt: new Date().toISOString(),
  companyName: null,
  brandName: null,
  contactName: "Maria",
};

describe("PipelineBoardDesktop", () => {
  it("renders all 10 stage columns, placing each opportunity in its own stage's column", () => {
    render(
      <PipelineBoardDesktop opportunities={[opportunity]} onSelect={() => {}} onMoveToStage={() => {}} />,
    );

    for (const label of Object.values(STAGE_LABELS)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // The one opportunity (stage QUALIFICACAO) appears once, inside that column.
    expect(screen.getAllByText("Maria")).toHaveLength(1);
  });

  it("renders cards with dnd-kit's draggable ARIA (desktop enables dragging)", () => {
    render(
      <PipelineBoardDesktop opportunities={[opportunity]} onSelect={() => {}} onMoveToStage={() => {}} />,
    );

    expect(screen.getByText("Maria").closest("[aria-roledescription]")).toHaveAttribute(
      "aria-roledescription",
      "draggable",
    );
  });
});

describe("resolveDragEndStageChange", () => {
  it("returns the stage change when dropped on a different stage", () => {
    const result = resolveDragEndStageChange(
      [opportunity],
      { active: { id: "o1" }, over: { id: "NEGOCIACAO" } } as unknown as DragEndEvent,
    );

    expect(result).toEqual({ opportunityId: "o1", stage: "NEGOCIACAO" });
  });

  it("is a no-op when dropped back on the same stage", () => {
    const result = resolveDragEndStageChange(
      [opportunity],
      { active: { id: "o1" }, over: { id: "QUALIFICACAO" } } as unknown as DragEndEvent,
    );

    expect(result).toBeNull();
  });

  it("is a no-op when dropped outside any droppable", () => {
    const result = resolveDragEndStageChange(
      [opportunity],
      { active: { id: "o1" }, over: null } as unknown as DragEndEvent,
    );

    expect(result).toBeNull();
  });
});
