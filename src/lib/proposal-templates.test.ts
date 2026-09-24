import { describe, it, expect } from "vitest";
import { PROPOSAL_TEMPLATES, PROPOSAL_TEMPLATE_LABELS, PROPOSAL_STATUS_LABELS } from "./proposal-templates";

describe("proposal templates", () => {
  it("lists all 6 templates with a Portuguese label each", () => {
    expect(PROPOSAL_TEMPLATES).toEqual([
      "PREMIUM",
      "MINIMAL",
      "EDITORIAL",
      "FASHION",
      "BEAUTY",
      "CORPORATE",
    ]);
    for (const template of PROPOSAL_TEMPLATES) {
      expect(PROPOSAL_TEMPLATE_LABELS[template]).toBeTruthy();
    }
    expect(PROPOSAL_TEMPLATE_LABELS.PREMIUM).toBe("Premium");
  });

  it("has a Portuguese label for both statuses", () => {
    expect(PROPOSAL_STATUS_LABELS.DRAFT).toBe("Rascunho");
    expect(PROPOSAL_STATUS_LABELS.ARCHIVED).toBe("Arquivada");
  });
});
