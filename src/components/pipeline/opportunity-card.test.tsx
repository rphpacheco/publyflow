// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpportunityCard } from "./opportunity-card";
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
  estimatedValueCents: 500000,
  createdAt: new Date(Date.now() - 3600000).toISOString(),
  companyName: "Bella Cosméticos",
  brandName: null,
  contactName: "Maria",
};

describe("OpportunityCard", () => {
  it("shows the company as the label when no brand is set, the formatted value, and calls onSelect on click", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <OpportunityCard opportunity={opportunity} onSelect={onSelect} onMoveToStage={vi.fn()} />,
    );

    expect(screen.getByText("Bella Cosméticos")).toBeInTheDocument();
    expect(screen.getByText("R$ 5.000,00")).toBeInTheDocument();

    await user.click(screen.getByText("Bella Cosméticos"));
    expect(onSelect).toHaveBeenCalledWith(opportunity);
  });

  it("offers 'Mover para...' with all 10 stages, current stage disabled, and calls onMoveToStage", async () => {
    const user = userEvent.setup();
    const onMoveToStage = vi.fn();
    const onSelect = vi.fn();

    render(
      <OpportunityCard opportunity={opportunity} onSelect={onSelect} onMoveToStage={onMoveToStage} />,
    );

    await user.click(screen.getByRole("button", { name: "Mover para..." }));

    const currentStageItem = await screen.findByRole("menuitem", { name: "Novo Lead" });
    expect(currentStageItem).toHaveAttribute("aria-disabled", "true");

    await user.click(screen.getByRole("menuitem", { name: "Qualificação" }));
    expect(onMoveToStage).toHaveBeenCalledWith("o1", "QUALIFICACAO");
    // Clicking the menu item must not also trigger the card's own onSelect.
    expect(onSelect).not.toHaveBeenCalled();
  });
});
