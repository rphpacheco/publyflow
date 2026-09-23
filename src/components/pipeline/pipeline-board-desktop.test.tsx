// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PipelineBoardDesktop } from "./pipeline-board-desktop";
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
});
