// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PipelineBoardMobile } from "./pipeline-board-mobile";
import type { OpportunityListItem } from "@/hooks/use-opportunities";

const opportunities: OpportunityListItem[] = [
  {
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
  },
  {
    id: "o2",
    organizationId: "org1",
    creatorId: "creator1",
    leadId: "lead2",
    companyId: null,
    brandId: null,
    stage: "QUALIFICACAO",
    status: "OPEN",
    estimatedValueCents: null,
    createdAt: new Date().toISOString(),
    companyName: null,
    brandName: null,
    contactName: "João",
  },
];

describe("PipelineBoardMobile", () => {
  it("shows only the first stage's column initially, and navigates forward with the next button", async () => {
    const user = userEvent.setup();
    render(
      <PipelineBoardMobile opportunities={opportunities} onSelect={() => {}} onMoveToStage={() => {}} />,
    );

    expect(screen.getByText("Novo Lead")).toBeInTheDocument();
    expect(screen.getByText("Maria")).toBeInTheDocument();
    expect(screen.queryByText("João")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stage anterior" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Próximo stage" }));

    expect(screen.getByText("Qualificação")).toBeInTheDocument();
    expect(screen.getByText("João")).toBeInTheDocument();
    expect(screen.queryByText("Maria")).not.toBeInTheDocument();
  });
});
