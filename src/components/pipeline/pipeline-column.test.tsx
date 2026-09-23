// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PipelineColumn } from "./pipeline-column";
import type { OpportunityListItem } from "@/hooks/use-opportunities";

const opportunity: OpportunityListItem = {
  id: "o1",
  organizationId: "org1",
  creatorId: "creator1",
  leadId: "lead1",
  companyId: null,
  brandId: null,
  stage: "NOVO_LEAD",
  status: "OPEN",
  estimatedValueCents: null,
  createdAt: new Date().toISOString(),
  companyName: null,
  brandName: null,
  contactName: "Maria",
};

describe("PipelineColumn", () => {
  it("renders the stage label, a count, and one card per opportunity", () => {
    render(
      <PipelineColumn
        stage="NOVO_LEAD"
        opportunities={[opportunity]}
        onSelect={() => {}}
        onMoveToStage={() => {}}
      />,
    );

    expect(screen.getByText("Novo Lead")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Maria")).toBeInTheDocument();
  });

  it("renders an empty column with a zero count and no cards", () => {
    render(
      <PipelineColumn stage="FECHADO" opportunities={[]} onSelect={() => {}} onMoveToStage={() => {}} />,
    );

    expect(screen.getByText("Fechado")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("threads draggable=true through to its cards (dnd-kit ARIA present)", () => {
    render(
      <PipelineColumn
        stage="NOVO_LEAD"
        opportunities={[opportunity]}
        onSelect={() => {}}
        onMoveToStage={() => {}}
        draggable
      />,
    );

    expect(screen.getByText("Maria").closest("[aria-roledescription]")).toHaveAttribute(
      "aria-roledescription",
      "draggable",
    );
  });

  it("does not thread draggable ARIA through when draggable is omitted", () => {
    render(
      <PipelineColumn
        stage="NOVO_LEAD"
        opportunities={[opportunity]}
        onSelect={() => {}}
        onMoveToStage={() => {}}
      />,
    );

    expect(screen.getByText("Maria").closest("[aria-roledescription]")).toBeNull();
  });
});
