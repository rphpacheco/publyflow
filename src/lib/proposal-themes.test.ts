import { describe, it, expect } from "vitest";
import { PROPOSAL_THEMES, PROPOSAL_THEME_LABELS, PROPOSAL_STATUS_LABELS } from "./proposal-themes";

describe("proposal themes", () => {
  it("lists all 6 themes with a Portuguese label each", () => {
    expect(PROPOSAL_THEMES).toEqual(["PREMIUM", "MINIMAL", "EDITORIAL", "FASHION", "BEAUTY", "CORPORATE"]);
    for (const theme of PROPOSAL_THEMES) {
      expect(PROPOSAL_THEME_LABELS[theme]).toBeTruthy();
    }
    expect(PROPOSAL_THEME_LABELS.PREMIUM).toBe("Premium");
    expect(PROPOSAL_THEME_LABELS.MINIMAL).toBe("Minimalista");
  });

  it("labels proposal statuses in Portuguese", () => {
    expect(PROPOSAL_STATUS_LABELS.DRAFT).toBe("Rascunho");
    expect(PROPOSAL_STATUS_LABELS.ARCHIVED).toBe("Arquivada");
  });
});
