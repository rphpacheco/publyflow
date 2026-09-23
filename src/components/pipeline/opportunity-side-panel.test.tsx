// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpportunitySidePanel } from "./opportunity-side-panel";
import type { OpportunityListItem } from "@/hooks/use-opportunities";

const opportunity: OpportunityListItem = {
  id: "o1",
  organizationId: "org1",
  creatorId: "creator1",
  leadId: "lead1",
  companyId: "c1",
  brandId: null,
  stage: "NOVO_LEAD",
  status: "OPEN",
  estimatedValueCents: 250000,
  createdAt: new Date().toISOString(),
  companyName: "Bella Cosméticos",
  brandName: null,
  contactName: "Maria",
};

describe("OpportunitySidePanel", () => {
  it("renders null when there's no opportunity", () => {
    const { container } = render(
      <OpportunitySidePanel opportunity={null} open={false} onOpenChange={() => {}} onMoveToStage={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the opportunity's data and changes stage via the Select", async () => {
    const user = userEvent.setup();
    const onMoveToStage = vi.fn();

    render(
      <OpportunitySidePanel
        opportunity={opportunity}
        open
        onOpenChange={() => {}}
        onMoveToStage={onMoveToStage}
      />,
    );

    expect(screen.getByText("Bella Cosméticos")).toBeInTheDocument();
    expect(screen.getByText("R$ 2.500,00")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Stage" }));
    await user.click(await screen.findByRole("option", { name: "Qualificação" }));

    expect(onMoveToStage).toHaveBeenCalledWith("o1", "QUALIFICACAO");
  });
});
